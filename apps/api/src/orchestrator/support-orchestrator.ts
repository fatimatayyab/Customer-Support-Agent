import { withWorkspaceContext } from "@csa/db";
import { NotFoundError } from "../errors.js";
import { generateSupportReply } from "../modules/ai/ai.service.js";
import {
  CONFIDENCE_ESCALATION_THRESHOLD,
  MAX_HISTORY_MESSAGES,
  MIN_RELEVANCE_SIMILARITY,
  RETRIEVAL_LIMIT,
} from "../modules/ai/ai.config.js";
import { NO_RELEVANT_KNOWLEDGE_MESSAGE, PROVIDER_ERROR_MESSAGE } from "../modules/ai/prompts/fallback-messages.js";
import {
  escalateConversation,
  getConversationById,
  insertConversation,
} from "../modules/conversations/conversation.repository.js";
import { insertMessage, listMessages } from "../modules/conversations/message.repository.js";
import { getCustomerById, insertCustomer } from "../modules/customers/customer.repository.js";
import { searchKnowledge } from "../modules/knowledge/knowledge.service.js";
import { publishToConversation } from "../modules/realtime/conversation-hub.js";
import { getWorkspaceById } from "../modules/workspaces/workspace.repository.js";

/**
 * This module IS the System Architecture's "Support Orchestrator" - the
 * single coordinator of the customer request lifecycle (03_System_Architecture.md).
 * It owns business logic and application state; downstream capabilities
 * (Knowledge retrieval in Phase 2, AI calls in Phase 3, human handoff in
 * Phase 4, Integration actions in Phase 5) extend the functions here
 * rather than replacing them or being called directly by transport code.
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
  const message = await withWorkspaceContext(params.workspaceId, async (scopedDb) => {
    const conversation = await getConversationById(scopedDb, params.workspaceId, params.conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found.");
    }

    return insertMessage(scopedDb, {
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
      senderType: "customer",
      content: params.content,
    });
  });

  // Broadcasts to every subscriber including the sender's own
  // connection - the widget renders on this authoritative echo rather
  // than optimistically, so there's exactly one code path for "a
  // message appeared," not two that need to stay in sync.
  publishToConversation(params.conversationId, { type: "message:receive", payload: message });

  // Not awaited: retrieval + generation can take a few seconds, and the
  // customer's own message shouldn't wait on that. Same fire-and-forget
  // pattern as Phase 2's knowledge processing - failures are recorded
  // via escalateConversation inside generateAiReply, not swallowed.
  void generateAiReply(params.workspaceId, params.conversationId, params.content).catch(() => {});

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
