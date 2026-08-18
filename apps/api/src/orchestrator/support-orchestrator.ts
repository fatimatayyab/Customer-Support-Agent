import { withWorkspaceContext } from "@csa/db";
import { AppError, NotFoundError } from "../errors.js";
import { getDefaultJobRunner, type JobRunner } from "../job-runner.js";
import type { AiProvider } from "../modules/ai/ai-provider.js";
import { generateSupportReply, summarizeConversationHistory } from "../modules/ai/ai.service.js";
import {
  CONFIDENCE_ESCALATION_THRESHOLD,
  MAX_HISTORY_MESSAGES,
  MIN_RELEVANCE_SIMILARITY,
  RETRIEVAL_LIMIT,
} from "../modules/ai/ai.config.js";
import {
  CONTACT_RECEIVED_MESSAGE,
  CUSTOMER_REQUESTED_HUMAN_MESSAGE,
  NO_RELEVANT_KNOWLEDGE_MESSAGE,
  PROVIDER_ERROR_MESSAGE,
} from "../modules/ai/prompts/fallback-messages.js";
import { insertConversationNote } from "../modules/conversations/conversation-note.repository.js";
import {
  getFullEscalationContactByConversationId,
  updateEscalationContactSyncStatus,
  upsertEscalationContact,
  type EscalationContactMethod,
} from "../modules/conversations/conversation-escalation-contact.repository.js";
import { listConversationEscalations } from "../modules/conversations/conversation-escalation.repository.js";
import {
  upsertConversationRating,
  type ConversationRatingValue,
} from "../modules/conversations/conversation-rating.repository.js";
import {
  assignConversation,
  escalateConversation,
  getConversationById,
  getConversationDetail,
  insertConversation,
  saveConversationSummary,
  updateConversationStatus,
  type ConversationStatus,
  type EscalationReason,
} from "../modules/conversations/conversation.repository.js";
import { insertMessage, listMessages, type MessageMetadata } from "../modules/conversations/message.repository.js";
import { getCustomerById, insertCustomer } from "../modules/customers/customer.repository.js";
import { insertIntegrationActionLog } from "../modules/integrations/integration-action-log.repository.js";
import { lookupContact as lookupContactViaIntegration } from "../modules/integrations/integration.service.js";
import type { ContactLookupResult, IntegrationProvider } from "../modules/integrations/integration-provider.js";
import type { EmbeddingProvider } from "../modules/knowledge/embedding-provider.js";
import { searchKnowledge } from "../modules/knowledge/knowledge.service.js";
import { syncEscalationContact as syncEscalationContactToPlatform } from "../modules/ops/escalation-sync.service.js";
import type { EscalationSyncProvider } from "../modules/ops/escalation-sync-provider.js";
import { publishToConversation } from "../modules/realtime/conversation-hub.js";
import { getUserById } from "../modules/users/user.repository.js";
import { getWorkspaceById } from "../modules/workspaces/workspace.repository.js";
import { isExplicitHumanRequest } from "./human-request-phrases.js";

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

/**
 * Optional, all-defaulted overrides for the handful of functions below
 * that reach a provider or run detached background work. Real
 * dependency injection: `deps` is a second, separate parameter from
 * each function's plain business-data params (never merged into them),
 * so production call sites never pass it and behavior is unchanged -
 * only a caller that wants to override something (today, only tests)
 * ever supplies it. This is what makes generateAiReply's fire-and-forget
 * AI-reply path deterministically testable without exporting any
 * `__set...ForTesting` function: swap in a SynchronousJobRunner and a
 * fake AiProvider/EmbeddingProvider here, and handleCustomerMessage's
 * returned promise doesn't resolve until that path has genuinely
 * finished. See job-runner.ts and ai.service.ts/knowledge.service.ts's
 * own default-parameter treatment of AiProvider/EmbeddingProvider for
 * the full reasoning.
 */
export interface OrchestratorDeps {
  jobRunner?: JobRunner;
  aiProvider?: AiProvider;
  embeddingProvider?: EmbeddingProvider;
  integrationProviderFactory?: (credentials: { accessToken: string }) => IntegrationProvider;
  // A direct instance override, not a factory like integrationProviderFactory
  // above - the platform escalation mirror is a singleton (one Airtable
  // base for the whole platform, modules/ops/escalation-sync.service.ts),
  // not constructed per-workspace from a workspace's own credentials, so
  // there's no per-call construction step to inject a factory for.
  escalationSyncProvider?: EscalationSyncProvider | null;
}

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
        // Tells the widget whether to offer the escalation-contact form
        // again on this resumed conversation - it must not, if the
        // customer already gave contact details earlier (even in a
        // different browser tab/session, since the widget's own
        // "already asked" state is otherwise just in-memory and resets
        // on every reload/reconnect).
        const existingContact = await getFullEscalationContactByConversationId(
          scopedDb,
          params.workspaceId,
          conversation.id,
        );
        return { customer, conversation, messages: history, hasEscalationContact: existingContact !== null };
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

    return { customer, conversation, messages: [], hasEscalationContact: false };
  });
}

interface HandleCustomerMessageParams {
  workspaceId: string;
  conversationId: string;
  content: string;
  // The website channel's context signal - only ever present when the
  // widget sent it (docs/00/02's Chat Widget direction: channel-specific,
  // never a universal assumption). Absent for any other future channel.
  pageUrl?: string;
  pageTitle?: string;
}

export async function handleCustomerMessage(params: HandleCustomerMessageParams, deps: OrchestratorDeps = {}) {
  const pageContext = params.pageUrl ? { url: params.pageUrl, title: params.pageTitle ?? "" } : undefined;

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
      ...(pageContext ? { metadata: { pageUrl: pageContext.url, pageTitle: pageContext.title } } : {}),
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
  //
  // Routed through JobRunner, not a bare `void ...`: in production
  // (InProcessJobRunner) this is exactly the same detached background
  // call as before - the HTTP/WS response doesn't wait on an AI call.
  // See job-runner.ts and this file's OrchestratorDeps comment for why.
  if (!assignedUserId) {
    const jobRunner = deps.jobRunner ?? getDefaultJobRunner();
    await jobRunner.run(() =>
      generateAiReply(params.workspaceId, params.conversationId, params.content, pageContext, deps).catch(() => {}),
    );
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
async function generateAiReply(
  workspaceId: string,
  conversationId: string,
  customerMessage: string,
  pageContext: { url: string; title: string } | undefined,
  deps: OrchestratorDeps = {},
): Promise<void> {
  publishToConversation(conversationId, { type: "typing:start", payload: {} });

  try {
    // Checked before retrieval, not after: a bare "talk to a human"
    // message usually matches no knowledge chunks at all, so if this ran
    // after the relevance-floor check below it would always lose to the
    // no_relevant_knowledge path and the model would never even see it.
    // Deterministic phrase matching, not a model call - see
    // human-request-phrases.ts for why precision over recall matters
    // here specifically.
    if (isExplicitHumanRequest(customerMessage)) {
      await recordEscalation(
        workspaceId,
        conversationId,
        { reason: "customer_requested_human", detail: "Customer explicitly asked to speak with a human." },
        deps,
      );
      await sendSystemMessage(workspaceId, conversationId, CUSTOMER_REQUESTED_HUMAN_MESSAGE, {
        escalated: true,
        escalationReason: "customer_requested_human",
      });
      return;
    }

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

    const relevantChunks = (
      await searchKnowledge(workspaceId, customerMessage, RETRIEVAL_LIMIT, deps.embeddingProvider)
    ).filter((chunk) => chunk.similarity >= MIN_RELEVANCE_SIMILARITY);

    if (relevantChunks.length === 0) {
      await recordEscalation(
        workspaceId,
        conversationId,
        {
          reason: "no_relevant_knowledge",
          detail: "No knowledge chunks met the minimum relevance threshold for this question.",
        },
        deps,
      );
      await sendSystemMessage(workspaceId, conversationId, NO_RELEVANT_KNOWLEDGE_MESSAGE, {
        escalated: true,
        escalationReason: "no_relevant_knowledge",
      });
      return;
    }

    const result = await generateSupportReply(
      {
        workspaceName,
        history: recentHistory,
        retrievedContext: relevantChunks.map((chunk) => ({
          knowledgeChunkId: chunk.id,
          knowledgeSourceId: chunk.knowledgeSourceId,
          content: chunk.content,
          similarity: chunk.similarity,
        })),
        customerMessage,
        pageContext,
      },
      deps.aiProvider,
    );

    // Escalation reason is decided before persisting, not after, so the
    // reply message itself can carry escalated/escalationReason in the
    // same write the widget's live message:receive event delivers - the
    // signal the widget uses to offer the contact form is attached to
    // the exact message that triggered it, not a separate follow-up patch.
    let escalation: { reason: EscalationReason; detail: string } | null = null;
    if (result.needsEscalation || result.confidence < CONFIDENCE_ESCALATION_THRESHOLD) {
      escalation = {
        reason: result.needsEscalation ? "ai_requested_escalation" : "low_confidence",
        detail: result.needsEscalation
          ? `Model requested escalation (confidence ${result.confidence.toFixed(2)}).`
          : `Confidence ${result.confidence.toFixed(2)} below threshold ${CONFIDENCE_ESCALATION_THRESHOLD}.`,
      };
    }

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
          ...(escalation ? { escalated: true, escalationReason: escalation.reason } : {}),
        },
      }),
    );

    if (escalation) {
      await recordEscalation(workspaceId, conversationId, escalation, deps);
    }

    publishToConversation(conversationId, { type: "typing:stop", payload: {} });
    publishToConversation(conversationId, { type: "message:receive", payload: aiMessage });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown AI provider error.";
    await recordEscalation(workspaceId, conversationId, { reason: "ai_provider_error", detail }, deps).catch(() => {});

    await sendSystemMessage(workspaceId, conversationId, PROVIDER_ERROR_MESSAGE, {
      escalated: true,
      escalationReason: "ai_provider_error",
    }).catch(() => {
      // Even the fallback failed to send - at least stop the indicator.
      publishToConversation(conversationId, { type: "typing:stop", payload: {} });
    });
  }
}

async function sendSystemMessage(
  workspaceId: string,
  conversationId: string,
  content: string,
  metadata?: MessageMetadata,
): Promise<void> {
  const message = await withWorkspaceContext(workspaceId, (scopedDb) =>
    insertMessage(scopedDb, { workspaceId, conversationId, senderType: "system", content, metadata }),
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
export async function suggestReplyForAgent(workspaceId: string, conversationId: string, deps: OrchestratorDeps = {}) {
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

  const relevantChunks = (
    await searchKnowledge(workspaceId, lastCustomerMessage.content, RETRIEVAL_LIMIT, deps.embeddingProvider)
  ).filter((chunk) => chunk.similarity >= MIN_RELEVANCE_SIMILARITY);

  if (relevantChunks.length === 0) {
    return null;
  }

  return generateSupportReply(
    {
      workspaceName,
      history: recentHistory,
      retrievedContext: relevantChunks.map((chunk) => ({
        knowledgeChunkId: chunk.id,
        knowledgeSourceId: chunk.knowledgeSourceId,
        content: chunk.content,
        similarity: chunk.similarity,
      })),
      customerMessage: lastCustomerMessage.content,
    },
    deps.aiProvider,
  );
}

/** On-demand only, not auto-triggered on escalation - see docs/07's Phase 4 notes for why. */
export async function summarizeConversationForAgent(
  workspaceId: string,
  conversationId: string,
  deps: OrchestratorDeps = {},
) {
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

  const result = await summarizeConversationHistory(
    {
      workspaceName,
      history: history
        .slice(-MAX_HISTORY_MESSAGES)
        .map((entry) => ({ senderType: entry.senderType, content: entry.content })),
    },
    deps.aiProvider,
  );

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

// --- Integration Service (Phase 5) ---

/**
 * Agent-triggered only (docs/07's Phase 5 notes) - the AI never calls
 * this itself. A successful lookup is recorded as an internal note
 * (conversation_notes, agent-only), never a broadcast system message:
 * unlike a claim/reassign audit message (safe, purely "who's helping
 * you" metadata that Phase 4 deliberately does show the customer), a CRM
 * record may contain something an agent hasn't decided is appropriate to
 * relay yet - the same reasoning conversation_notes exists for.
 *
 * Every attempt is logged to integration_action_logs regardless of
 * outcome - the audit trail 02_Product_Blueprint.md requires for the
 * Act pillar ("every action must be secure, auditable, and
 * permission-controlled"). "No integration connected" is a precondition,
 * not a loggable action - it's rejected before this point, inside
 * integration.service.ts, since there's no integration row yet to
 * attribute a log entry to.
 */
export async function lookupContact(
  workspaceId: string,
  conversationId: string,
  userId: string,
  email: string,
  deps: OrchestratorDeps = {},
): Promise<ContactLookupResult> {
  const conversation = await withWorkspaceContext(workspaceId, (scopedDb) =>
    getConversationById(scopedDb, workspaceId, conversationId),
  );
  if (!conversation) {
    throw new NotFoundError("Conversation not found.");
  }

  const outcome = await lookupContactViaIntegration(workspaceId, email, deps.integrationProviderFactory);

  await withWorkspaceContext(workspaceId, (scopedDb) =>
    insertIntegrationActionLog(scopedDb, {
      workspaceId,
      integrationId: outcome.integrationId,
      conversationId,
      actionName: "contact-lookup",
      requestParams: { email },
      resultStatus: outcome.result ? "success" : "failure",
      resultSummary: outcome.result
        ? outcome.result.found
          ? `Found contact: ${outcome.result.name ?? outcome.result.email}.`
          : "No matching contact found."
        : (outcome.errorMessage ?? "Unknown integration error."),
      triggeredByUserId: userId,
    }),
  );

  if (!outcome.result) {
    // Specific message is safe here - this route is dashboard-only,
    // never customer-facing, same allowance CLAUDE.md gives admin routes
    // generally. 502: the failure is upstream (the provider), not this API.
    throw new AppError(`Contact lookup failed: ${outcome.errorMessage ?? "unknown error"}.`, 502);
  }

  if (outcome.result.found) {
    const { result } = outcome;
    const summary = [
      `Contact lookup for ${email}:`,
      result.name ? `Name: ${result.name}` : null,
      result.company ? `Company: ${result.company}` : null,
      result.phone ? `Phone: ${result.phone}` : null,
      result.lifecycleStage ? `Lifecycle stage: ${result.lifecycleStage}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join(" ");

    await withWorkspaceContext(workspaceId, (scopedDb) =>
      insertConversationNote(scopedDb, { workspaceId, conversationId, userId, content: summary }),
    );
  }

  return outcome.result;
}

// --- Customer Satisfaction (Improve) ---

/**
 * Customer-facing, widget-triggered - unlike claimConversation/
 * changeConversationStatus/etc. above, the caller here is the customer's
 * own browser (conversation-rating.routes.ts, API-key authenticated),
 * not a logged-in agent. Still goes through the Orchestrator rather than
 * a route-to-repository shortcut, matching initiateConversation/
 * handleCustomerMessage's precedent for every widget-facing write: the
 * conversationId is client-supplied and gets looked up against this
 * workspace before use, never trusted at face value.
 */
export async function rateConversation(
  workspaceId: string,
  conversationId: string,
  rating: ConversationRatingValue,
): Promise<void> {
  await withWorkspaceContext(workspaceId, async (scopedDb) => {
    const conversation = await getConversationById(scopedDb, workspaceId, conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found.");
    }
    await upsertConversationRating(scopedDb, { workspaceId, conversationId, rating });
  });
}

// --- Human Escalation Contact Capture ---

interface ConversationEscalationMetadata {
  escalation?: { reason: EscalationReason; detail: string; escalatedAt: string };
}

/**
 * The single funnel every escalation path (generateAiReply's four call
 * sites) now goes through, instead of calling escalateConversation
 * directly - escalateConversation itself only ever touches Postgres
 * (conversations.metadata + the new conversation_escalations history
 * row). Keeping a customer's contact submission current in the
 * platform's escalation mirror once they've already given one is a
 * separate, network-reaching concern that belongs at the Orchestrator
 * layer, not the repository.
 *
 * captureEscalationContact (below) is what fires the *first* sync, when
 * a contact is submitted. This is what keeps that same Airtable record
 * current on every *later* escalation on the same conversation - without
 * it, a conversation that escalates again after its one contact
 * submission would silently go stale in the mirror, since nothing else
 * would ever re-trigger a sync (the widget deliberately doesn't re-ask
 * for contact details once already given - see captureEscalationContact).
 */
async function recordEscalation(
  workspaceId: string,
  conversationId: string,
  escalation: { reason: EscalationReason; detail: string },
  deps: OrchestratorDeps,
): Promise<void> {
  await withWorkspaceContext(workspaceId, (scopedDb) =>
    escalateConversation(scopedDb, workspaceId, conversationId, escalation),
  );

  const existingContact = await withWorkspaceContext(workspaceId, (scopedDb) =>
    getFullEscalationContactByConversationId(scopedDb, workspaceId, conversationId),
  );
  if (!existingContact) {
    return;
  }

  const jobRunner = deps.jobRunner ?? getDefaultJobRunner();
  await jobRunner.run(() =>
    syncEscalationContactToPlatformMirror(workspaceId, conversationId, existingContact, deps).catch(() => {}),
  );
}

/**
 * Customer-facing, widget-triggered - same shape as rateConversation
 * above: the conversationId is client-supplied and looked up against
 * this workspace before use, never trusted at face value.
 *
 * The escalation reason/detail are snapshotted from conversation.metadata
 * once, here, and stored on the contact row itself - not re-read live at
 * sync time. escalateConversation's jsonb merge overwrites
 * conversation.metadata.escalation on every new escalation event, so a
 * live read (at sync time, or worse, on a retry days later) could attach
 * a later, unrelated escalation's reason to a contact captured in
 * response to an earlier one.
 *
 * The sync into the platform's internal escalation mirror (modules/ops/)
 * is fire-and-forget via JobRunner and never blocks this function's own
 * return or the confirmation message - Postgres (conversation_escalation_
 * contacts) is the authoritative record regardless of whether the
 * platform's Airtable is configured or reachable. This is a platform-
 * level sink, not a workspace integration - see ops/escalation-sync.
 * service.ts for why an unconfigured platform is a silent no-op here,
 * not an error, and CLAUDE.md's Integration Service note on why Airtable
 * isn't in modules/integrations at all.
 */
export async function captureEscalationContact(
  workspaceId: string,
  conversationId: string,
  contact: { name: string; contactMethod: EscalationContactMethod; contactValue: string },
  deps: OrchestratorDeps = {},
): Promise<void> {
  const savedContact = await withWorkspaceContext(workspaceId, async (scopedDb) => {
    const found = await getConversationById(scopedDb, workspaceId, conversationId);
    if (!found) {
      throw new NotFoundError("Conversation not found.");
    }
    const escalation = (found.metadata as ConversationEscalationMetadata).escalation;
    return upsertEscalationContact(scopedDb, {
      workspaceId,
      conversationId,
      ...contact,
      escalationReason: escalation?.reason ?? "customer_requested_human",
      escalationDetail: escalation?.detail ?? "",
    });
  });

  await sendSystemMessage(workspaceId, conversationId, CONTACT_RECEIVED_MESSAGE);

  // Routed through JobRunner, not a bare `void ...` - same reasoning as
  // handleCustomerMessage's generateAiReply call: production
  // (InProcessJobRunner) never blocks on this, SynchronousJobRunner makes
  // it deterministically awaitable in tests. .catch swallows any
  // unexpected failure here the same way generateAiReply's own call does
  // - a broken Airtable sync must never surface as a failure of the
  // customer-facing contact submission, which already succeeded above.
  const jobRunner = deps.jobRunner ?? getDefaultJobRunner();
  await jobRunner.run(() => syncEscalationContactToPlatformMirror(workspaceId, conversationId, savedContact, deps).catch(() => {}));
}

// Turns the full, ordered escalation history into the two fields the
// platform mirror actually gets: a compact list of every distinct
// reason this conversation has escalated for (first-occurrence order,
// not deduplicated-away - "all of them," per the whole point of keeping
// a history instead of a single overwritten field), and a numbered,
// timestamped narrative for the long-text detail field. Pure formatting,
// no I/O, so it's trivial to unit-test independent of the sync call.
function summarizeEscalationHistory(
  events: { reason: string; detail: string; escalatedAt: Date }[],
): { reasonSummary: string; detailSummary: string } {
  const uniqueReasons = [...new Set(events.map((event) => event.reason))];
  const detailSummary = events
    .map((event, index) => `${index + 1}. [${event.reason}] ${event.escalatedAt.toISOString()} - ${event.detail}`)
    .join("\n");
  return { reasonSummary: uniqueReasons.join(", "), detailSummary };
}

async function syncEscalationContactToPlatformMirror(
  workspaceId: string,
  conversationId: string,
  contact: {
    id: string;
    name: string;
    contactMethod: EscalationContactMethod;
    contactValue: string;
    airtableRecordId: string | null;
  },
  deps: OrchestratorDeps,
): Promise<void> {
  const { workspace, history } = await withWorkspaceContext(workspaceId, async (scopedDb) => {
    const workspace = await getWorkspaceById(scopedDb, workspaceId);
    const history = await listConversationEscalations(scopedDb, workspaceId, conversationId);
    return { workspace, history };
  });

  const { reasonSummary, detailSummary } = summarizeEscalationHistory(history);

  const outcome = await syncEscalationContactToPlatform(
    {
      name: contact.name,
      contactMethod: contact.contactMethod,
      contactValue: contact.contactValue,
      conversationId,
      workspaceName: workspace?.name ?? "Unknown workspace",
      escalationReason: reasonSummary,
      escalationDetail: detailSummary,
      existingRecordId: contact.airtableRecordId ?? undefined,
    },
    deps.escalationSyncProvider,
  );

  // outcome === null: the platform's own Airtable isn't configured
  // (env.ts's AIRTABLE_* vars unset) - nothing to sync, nothing to mark
  // failed. The row stays 'pending' rather than a misleading 'failed'.
  if (!outcome) {
    return;
  }

  await withWorkspaceContext(workspaceId, (scopedDb) =>
    updateEscalationContactSyncStatus(
      scopedDb,
      contact.id,
      outcome.result ? "synced" : "failed",
      outcome.result?.recordId,
    ),
  );
}
