import { withWorkspaceContext } from "@csa/db";
import { NotFoundError } from "../errors.js";
import { generateSupportReply, summarizeConversationHistory } from "../modules/ai/ai.service.js";
import {
  CONFIDENCE_ESCALATION_THRESHOLD,
  MAX_HISTORY_MESSAGES,
  MIN_RELEVANCE_SIMILARITY,
  RETRIEVAL_LIMIT,
} from "../modules/ai/ai.config.js";
import { NO_RELEVANT_KNOWLEDGE_MESSAGE, PROVIDER_ERROR_MESSAGE } from "../modules/ai/prompts/fallback-messages.js";
import { insertConversationNote } from "../modules/conversations/conversation-note.repository.js";
import {
  assignConversation,
  escalateConversation,
  getConversationById,
  getConversationDetail,
  insertConversation,
  saveConversationSummary,
  updateConversationStatus,
  type ConversationStatus,
} from "../modules/conversations/conversation.repository.js";
import { insertMessage, listMessages } from "../modules/conversations/message.repository.js";
import { getCustomerById, insertCustomer } from "../modules/customers/customer.repository.js";
import { searchKnowledge } from "../modules/knowledge/knowledge.service.js";
import { publishToConversation } from "../modules/realtime/conversation-hub.js";
import { getUserById } from "../modules/users/user.repository.js";
import { getWorkspaceById } from "../modules/workspaces/workspace.repository.js";

/**
 * This module IS the System Architecture's "Support Orchestrator" - the
 * single coordinator of the customer request lifecycle (03_System_Architecture.md).
 * It owns business logic and application state; downstream capabilities
 * (Knowledge retrieval in Phase 2, AI calls in Phase 3, human handoff in
 * Phase 4, Integration actions in Phase 5) extend the functions here
 * rather than replacing them or being called directly by transport code.
 *
 * Plain reads that touch only one module (list/get conversations,
 * messages, notes) are called directly from conversation.routes.ts
 * instead of through here - same precedent workspace.routes.ts and
 * knowledge.routes.ts already established for single-module reads.
 * Everything below either changes conversation state, has a broadcast
 * side effect, or crosses module boundaries (knowledge + AI), which is
 * exactly what belongs in the Orchestrator.
 */

interface InitiateConversationParams {
  workspaceId: string;
  customerId?: string;
  conversationId?: string;
}

export async function initiateConversation(params: InitiateConversationParams) {
  return withWorkspaceContext(params.workspaceId, async (scopedDb) => {
    // A resumable conversationId is authoritative when it resolves: the
    // conversation already implies its customer, so any separately
    // supplied customerId is ignored rather than trusted at face value.
    if (params.conversationId) {
      const conversation = await getConversationById(scopedDb, params.workspaceId, params.conversationId);
      if (conversation) {
        const customer = await getCustomerById(scopedDb, params.workspaceId, conversation.customerId);
        if (!customer) {
          throw new NotFoundError("initiateConversation: conversation.customerId has no matching row.");
        }
        const history = await listMessages(scopedDb, params.workspaceId, conversation.id);
        return { customer, conversation, messages: history };
      }
      // Stale or invalid conversationId (e.g. from an old localStorage
      // value) - fall through and start fresh below.
    }

    const customer = params.customerId
      ? ((await getCustomerById(scopedDb, params.workspaceId, params.customerId)) ??
        (await insertCustomer(scopedDb, { workspaceId: params.workspaceId })))
      : await insertCustomer(scopedDb, { workspaceId: params.workspaceId });

    const conversation = await insertConversation(scopedDb, {
      workspaceId: params.workspaceId,
      customerId: customer.id,
    });

    return { customer, conversation, messages: [] };
  });
}

interface HandleCustomerMessageParams {
  workspaceId: string;
  conversationId: string;
  content: string;
}

export async function handleCustomerMessage(params: HandleCustomerMessageParams) {
  const { message, assignedUserId } = await withWorkspaceContext(params.workspaceId, async (scopedDb) => {
    const conversation = await getConversationById(scopedDb, params.workspaceId, params.conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found.");
    }

    const inserted = await insertMessage(scopedDb, {
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
      senderType: "customer",
      content: params.content,
    });

    return { message: inserted, assignedUserId: conversation.assignedUserId };
  });

  // Broadcasts to every subscriber including the sender's own
  // connection - the widget renders on this authoritative echo rather
  // than optimistically, so there's exactly one code path for "a
  // message appeared," not two that need to stay in sync.
  publishToConversation(params.conversationId, { type: "message:receive", payload: message });

  // This is the actual mechanism behind "live takeover" (02_Product_Blueprint.md):
  // once a human has claimed the conversation, the AI stops auto-replying
  // to the customer. It keeps helping right up until that point,
  // including while merely 'escalated' but still unclaimed - a human
  // being unavailable shouldn't mean the customer gets silence.
  if (!assignedUserId) {
    void generateAiReply(params.workspaceId, params.conversationId, params.content).catch(() => {});
  }

  return message;
}

/**
 * Retrieval, then generation, then persist + broadcast - the
 * combination Phase 2 deliberately deferred. Two structural guarantees
 * against the AI answering from its own general knowledge rather than
 * this workspace's: (1) if nothing retrieved clears the relevance
 * floor, the model is never called at all; (2) the system prompt
 * (prompts/support-reply.prompt.ts) instructs it to refuse rather than
 * guess even when it is called. Confidence/escalation is a second,
 * independent layer on top of both.
 */
async function generateAiReply(workspaceId: string, conversationId: string, customerMessage: string): Promise<void> {
  publishToConversation(conversationId, { type: "typing:start", payload: {} });

  try {
    const { workspaceName, history } = await withWorkspaceContext(workspaceId, async (scopedDb) => {
      const workspace = await getWorkspaceById(scopedDb, workspaceId);
      if (!workspace) {
        throw new NotFoundError("generateAiReply: workspace not found for an active conversation.");
      }
      const allMessages = await listMessages(scopedDb, workspaceId, conversationId);
      return { workspaceName: workspace.name, history: allMessages };
    });

    const recentHistory = history
      .slice(-MAX_HISTORY_MESSAGES)
      .map((entry) => ({ senderType: entry.senderType, content: entry.content }));

    const relevantChunks = (await searchKnowledge(workspaceId, customerMessage, RETRIEVAL_LIMIT)).filter(
      (chunk) => chunk.similarity >= MIN_RELEVANCE_SIMILARITY,
    );

    if (relevantChunks.length === 0) {
      await withWorkspaceContext(workspaceId, (scopedDb) =>
        escalateConversation(scopedDb, workspaceId, conversationId, {
          reason: "no_relevant_knowledge",
          detail: "No knowledge chunks met the minimum relevance threshold for this question.",
        }),
      );
      await sendSystemMessage(workspaceId, conversationId, NO_RELEVANT_KNOWLEDGE_MESSAGE);
      return;
    }

    const result = await generateSupportReply({
      workspaceName,
      history: recentHistory,
      retrievedContext: relevantChunks.map((chunk) => ({
        knowledgeChunkId: chunk.id,
        knowledgeSourceId: chunk.knowledgeSourceId,
        content: chunk.content,
        similarity: chunk.similarity,
      })),
      customerMessage,
    });

    const aiMessage = await withWorkspaceContext(workspaceId, (scopedDb) =>
      insertMessage(scopedDb, {
        workspaceId,
        conversationId,
        senderType: "ai",
        content: result.reply,
        metadata: {
          provider: result.provider,
          model: result.model,
          promptVersion: result.promptVersion,
          confidence: result.confidence,
          citations: result.citations,
          usage: result.usage,
          finishReason: result.finishReason,
        },
      }),
    );

    if (result.needsEscalation || result.confidence < CONFIDENCE_ESCALATION_THRESHOLD) {
      await withWorkspaceContext(workspaceId, (scopedDb) =>
        escalateConversation(scopedDb, workspaceId, conversationId, {
          reason: result.needsEscalation ? "ai_requested_escalation" : "low_confidence",
          detail: result.needsEscalation
            ? `Model requested escalation (confidence ${result.confidence.toFixed(2)}).`
            : `Confidence ${result.confidence.toFixed(2)} below threshold ${CONFIDENCE_ESCALATION_THRESHOLD}.`,
        }),
      );
    }

    publishToConversation(conversationId, { type: "typing:stop", payload: {} });
    publishToConversation(conversationId, { type: "message:receive", payload: aiMessage });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown AI provider error.";
    await withWorkspaceContext(workspaceId, (scopedDb) =>
      escalateConversation(scopedDb, workspaceId, conversationId, { reason: "ai_provider_error", detail }),
    ).catch(() => {});

    await sendSystemMessage(workspaceId, conversationId, PROVIDER_ERROR_MESSAGE).catch(() => {
      // Even the fallback failed to send - at least stop the indicator.
      publishToConversation(conversationId, { type: "typing:stop", payload: {} });
    });
  }
}

async function sendSystemMessage(workspaceId: string, conversationId: string, content: string): Promise<void> {
  const message = await withWorkspaceContext(workspaceId, (scopedDb) =>
    insertMessage(scopedDb, { workspaceId, conversationId, senderType: "system", content }),
  );
  publishToConversation(conversationId, { type: "typing:stop", payload: {} });
  publishToConversation(conversationId, { type: "message:receive", payload: message });
}

// --- Agent Console (Phase 4) ---

/**
 * Deliberately permissive: any workspace member can claim an unassigned
 * conversation or reassign one already claimed by someone else - no
 * "can't steal an active claim" guard. Reasonable for the 1-3 person
 * team this is built for, and cheap to tighten later since it's a
 * permission check, not a schema commitment. What IS deliberate here is
 * that every claim/reassignment leaves a visible trace: a 'system'
 * message posted through the same broadcast path as any other message,
 * so it's both part of the permanent shared history and immediately
 * visible to anyone (e.g. the previous assignee) currently viewing the
 * conversation live.
 */
export async function claimConversation(workspaceId: string, conversationId: string, userId: string): Promise<void> {
  const auditText = await withWorkspaceContext(workspaceId, async (scopedDb) => {
    const conversation = await getConversationDetail(scopedDb, workspaceId, conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found.");
    }

    const newAssignee = await getUserById(scopedDb, workspaceId, userId);
    if (!newAssignee) {
      throw new NotFoundError("claimConversation: assigning user not found.");
    }

    if (conversation.assignedUserId === userId) {
      // Already assigned to this same user - permissive backend allows
      // re-claiming, but there's nothing to announce.
      return null;
    }

    await assignConversation(scopedDb, workspaceId, conversationId, userId);

    return conversation.assignedUserName
      ? `Reassigned from ${conversation.assignedUserName} to ${newAssignee.name}.`
      : `${newAssignee.name} claimed this conversation.`;
  });

  if (auditText) {
    await sendSystemMessage(workspaceId, conversationId, auditText);
  }
}

export async function changeConversationStatus(
  workspaceId: string,
  conversationId: string,
  status: ConversationStatus,
): Promise<void> {
  await withWorkspaceContext(workspaceId, async (scopedDb) => {
    const conversation = await getConversationById(scopedDb, workspaceId, conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found.");
    }
    await updateConversationStatus(scopedDb, workspaceId, conversationId, status);
  });
}

export async function sendAgentMessage(workspaceId: string, conversationId: string, userId: string, content: string) {
  const message = await withWorkspaceContext(workspaceId, async (scopedDb) => {
    const conversation = await getConversationById(scopedDb, workspaceId, conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found.");
    }
    return insertMessage(scopedDb, {
      workspaceId,
      conversationId,
      senderType: "agent",
      senderUserId: userId,
      content,
    });
  });

  publishToConversation(conversationId, { type: "message:receive", payload: message });
  return message;
}

/**
 * Never broadcast, unlike every other message-producing function here -
 * see the comment on messageSenderTypeEnum (packages/db/src/schema/messages.ts)
 * for why notes live in a separate table in the first place. Broadcasting
 * this through the same conversationId channel the customer's widget is
 * subscribed to would leak it straight to them.
 */
export async function addInternalNote(workspaceId: string, conversationId: string, userId: string, content: string) {
  return withWorkspaceContext(workspaceId, async (scopedDb) => {
    const conversation = await getConversationById(scopedDb, workspaceId, conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found.");
    }
    return insertConversationNote(scopedDb, { workspaceId, conversationId, userId, content });
  });
}

/**
 * A draft for the agent to review, edit, or discard - never persisted
 * or broadcast on its own (only sendAgentMessage does that, once the
 * agent decides to actually send something). Reuses the exact same
 * generateSupportReply call generateAiReply uses; the only difference
 * is what the caller does with the result afterward. Applies the same
 * structural grounding guarantee as the customer-facing path (Phase 3's
 * fifth requirement): if nothing retrieved clears the relevance floor,
 * returns null rather than calling the model - a fabricated suggestion
 * is still a bad suggestion, even if a human reviews it before it goes
 * anywhere.
 */
export async function suggestReplyForAgent(workspaceId: string, conversationId: string) {
  const { workspaceName, history } = await withWorkspaceContext(workspaceId, async (scopedDb) => {
    const conversation = await getConversationById(scopedDb, workspaceId, conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found.");
    }
    const workspace = await getWorkspaceById(scopedDb, workspaceId);
    if (!workspace) {
      throw new NotFoundError("suggestReplyForAgent: workspace not found.");
    }
    const allMessages = await listMessages(scopedDb, workspaceId, conversationId);
    return { workspaceName: workspace.name, history: allMessages };
  });

  const lastCustomerMessage = [...history].reverse().find((entry) => entry.senderType === "customer");
  if (!lastCustomerMessage) {
    return null;
  }

  const recentHistory = history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((entry) => ({ senderType: entry.senderType, content: entry.content }));

  const relevantChunks = (await searchKnowledge(workspaceId, lastCustomerMessage.content, RETRIEVAL_LIMIT)).filter(
    (chunk) => chunk.similarity >= MIN_RELEVANCE_SIMILARITY,
  );

  if (relevantChunks.length === 0) {
    return null;
  }

  return generateSupportReply({
    workspaceName,
    history: recentHistory,
    retrievedContext: relevantChunks.map((chunk) => ({
      knowledgeChunkId: chunk.id,
      knowledgeSourceId: chunk.knowledgeSourceId,
      content: chunk.content,
      similarity: chunk.similarity,
    })),
    customerMessage: lastCustomerMessage.content,
  });
}

/** On-demand only, not auto-triggered on escalation - see docs/07's Phase 4 notes for why. */
export async function summarizeConversationForAgent(workspaceId: string, conversationId: string) {
  const { workspaceName, history } = await withWorkspaceContext(workspaceId, async (scopedDb) => {
    const conversation = await getConversationById(scopedDb, workspaceId, conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found.");
    }
    const workspace = await getWorkspaceById(scopedDb, workspaceId);
    if (!workspace) {
      throw new NotFoundError("summarizeConversationForAgent: workspace not found.");
    }
    const allMessages = await listMessages(scopedDb, workspaceId, conversationId);
    return { workspaceName: workspace.name, history: allMessages };
  });

  const result = await summarizeConversationHistory({
    workspaceName,
    history: history.slice(-MAX_HISTORY_MESSAGES).map((entry) => ({ senderType: entry.senderType, content: entry.content })),
  });

  await withWorkspaceContext(workspaceId, (scopedDb) =>
    saveConversationSummary(scopedDb, workspaceId, conversationId, {
      text: result.summary,
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
      usage: result.usage,
    }),
  );

  return result;
}
