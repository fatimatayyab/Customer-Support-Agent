import { withWorkspaceContext } from "@csa/db";
import { z } from "zod";
import { AppError, NotFoundError } from "../errors.js";
import { getDefaultJobRunner, type JobRunner } from "../job-runner.js";
import type {
  AiProvider,
  AiReplyResult,
  AiToolCallOutcome,
  AiToolName,
  AiToolResult,
  Citation,
} from "../modules/ai/ai-provider.js";
import { LOOKUP_CONTACT_TOOL } from "../modules/ai/ai-provider.js";
import { generateSupportReply, summarizeConversationHistory } from "../modules/ai/ai.service.js";
import {
  CONFIDENCE_ESCALATION_THRESHOLD,
  MAX_AI_TRIGGERED_LOOKUPS_PER_CONVERSATION,
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
import {
  CONTACT_LOOKUP_ACTION_NAME,
  countAiTriggeredLookups,
  insertIntegrationActionLog,
} from "../modules/integrations/integration-action-log.repository.js";
import {
  isAiToolCallingEnabled,
  lookupContact as lookupContactViaIntegration,
} from "../modules/integrations/integration.service.js";
import type { ContactLookupResult, IntegrationProvider } from "../modules/integrations/integration-provider.js";
import type { EmbeddingProvider } from "../modules/knowledge/embedding-provider.js";
import { searchKnowledge } from "../modules/knowledge/knowledge.service.js";
import { syncEscalationContact as syncEscalationContactToPlatform } from "../modules/ops/escalation-sync.service.js";
import type { EscalationSyncProvider } from "../modules/ops/escalation-sync-provider.js";
import { publishToConversation } from "../modules/realtime/conversation-hub.js";
import { getUserById } from "../modules/users/user.repository.js";
import { getWorkspaceById } from "../modules/workspaces/workspace.repository.js";
import { isExplicitHumanRequest } from "./human-request-phrases.js";
import { extractEmails, hasIdentifiableEmail, isAccountLookupQuestion } from "./integration-lookup-phrases.js";

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

    // Customer-authored text only - deliberately excludes AI/system
    // messages, so an earlier AI reply or system fallback message can't
    // itself satisfy the email-presence half of the gate below, and so
    // extractEmails (used later to authorize which email the tool may
    // actually run against) can never resolve to an email the workspace's
    // own side of the conversation introduced.
    const customerTexts = [
      customerMessage,
      ...recentHistory.filter((entry) => entry.senderType === "customer").map((entry) => entry.content),
    ];

    // Independent of each other - retrieval never depends on the tool
    // gate's DB check or vice versa - so they run concurrently rather
    // than paying both latencies back to back on every single reply.
    const [relevantChunks, toolsAvailable] = await Promise.all([
      searchKnowledge(workspaceId, customerMessage, RETRIEVAL_LIMIT, deps.embeddingProvider).then((chunks) =>
        chunks.filter((chunk) => chunk.similarity >= MIN_RELEVANCE_SIMILARITY),
      ),
      // Narrow, defensible eligibility gate (integration-lookup-phrases.ts):
      // a connected+enabled integration is necessary but never sufficient
      // on its own to expose lookup_contact - some customer turn must ALSO
      // look like a plausible account-identity question, with an email
      // somewhere in context. Without this, any knowledge-empty message in
      // a workspace that happens to have HubSpot connected would bypass
      // the no_relevant_knowledge fast path below, regardless of topic.
      resolveToolsAvailable(workspaceId, customerTexts),
    ]);

    if (relevantChunks.length === 0 && toolsAvailable.length === 0) {
      // Exactly today's behavior: zero relevant chunks and no eligible
      // tool means there is nothing grounded for the model to work with,
      // so it is never called at all.
      await escalateNoRelevantKnowledge(
        workspaceId,
        conversationId,
        "No knowledge chunks met the minimum relevance threshold for this question.",
        deps,
      );
      return;
    }

    const retrievedContext = relevantChunks.map((chunk) => ({
      knowledgeChunkId: chunk.id,
      knowledgeSourceId: chunk.knowledgeSourceId,
      content: chunk.content,
      similarity: chunk.similarity,
    }));

    const outcome = await generateSupportReply(
      { workspaceName, history: recentHistory, retrievedContext, customerMessage, pageContext, toolsAvailable },
      deps.aiProvider,
    );

    let toolAttempted: AiToolName | undefined;
    let toolOutcome: "found" | "not_found" | "error" | undefined;
    let result: AiReplyResult;

    if (outcome.kind === "tool_call") {
      toolAttempted = outcome.tool;
      const executed = await executeToolCall(workspaceId, conversationId, outcome, toolsAvailable, customerTexts, deps);
      toolOutcome = executed.toolOutcome;

      // Structural guarantee, not just a prompt instruction - the same
      // principle the pre-existing relevance floor exists for (see this
      // function's own opening comment). If there was no relevant
      // knowledge AND the tool path never actually produced real
      // grounding either (rejected, rate-limited, or failed), this is
      // exactly the original "nothing to answer from" case - skip the
      // second call entirely (nothing to ground a reply on, so nothing
      // worth generating) rather than spend it only to discard whatever
      // the model says and fall back anyway.
      if (relevantChunks.length === 0 && toolOutcome !== "found" && toolOutcome !== "not_found") {
        await escalateNoRelevantKnowledge(
          workspaceId,
          conversationId,
          "No knowledge chunks met the minimum relevance threshold, and the offered lookup produced no grounding either.",
          deps,
        );
        return;
      }

      const finalOutcome = await generateSupportReply(
        { workspaceName, history: recentHistory, retrievedContext, customerMessage, pageContext, toolResult: executed.toolResult },
        deps.aiProvider,
      );

      // The second call always forces respond_to_customer (both provider
      // implementations stop offering lookup_contact once toolResult is
      // set) - a tool_call here means a provider violated that contract.
      // Bounded two-call flow, not a loop: surface it as a provider
      // error rather than silently looping or guessing.
      if (finalOutcome.kind === "tool_call") {
        throw new Error("Provider returned a tool_call on the forced final respond_to_customer call.");
      }
      result = {
        ...finalOutcome,
        // Both calls spent real tokens - the first call (system prompt +
        // tool schema + history, which ended in a tool_call rather than a
        // reply) must not be silently dropped from what gets persisted,
        // or analytics.repository.ts's token/cost aggregation undercounts
        // every tool-attempted reply by the entire first call.
        usage: {
          inputTokens: outcome.usage.inputTokens + finalOutcome.usage.inputTokens,
          outputTokens: outcome.usage.outputTokens + finalOutcome.usage.outputTokens,
        },
      };
    } else {
      result = outcome;

      // Same structural guarantee as above, for the path where the
      // model was offered the tool but chose to answer directly instead
      // of calling it - toolOutcome stays undefined here, which is
      // exactly the "no grounding produced" case.
      if (relevantChunks.length === 0 && toolOutcome !== "found" && toolOutcome !== "not_found") {
        await escalateNoRelevantKnowledge(
          workspaceId,
          conversationId,
          "No knowledge chunks met the minimum relevance threshold, and the model did not use the offered lookup.",
          deps,
        );
        return;
      }
    }

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
          ...(toolAttempted ? { toolAttempted, toolOutcome } : {}),
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

// The model's tool-call args are untrusted model output, not a route
// body, but the same rule applies (CLAUDE.md: validate at the
// boundary) - a malformed, empty, or non-email-shaped string must
// never reach lookupContact/insertIntegrationActionLog unchecked. Both
// providers pass through "" rather than throwing on missing/malformed
// SDK output (see their own comments), so .email() is what actually
// rejects that case here rather than it silently "authorizing" an
// empty string against the customer-email set.
const lookupContactArgsSchema = z.object({ email: z.string().email() });

/**
 * The narrow eligibility gate a connected integration alone must NOT
 * satisfy on its own (see generateAiReply's comment above its call
 * site). Cheap, deterministic checks run first and short-circuit before
 * the one DB round-trip (isAiToolCallingEnabled) - most messages never
 * reach it.
 */
async function resolveToolsAvailable(workspaceId: string, customerTexts: string[]): Promise<AiToolName[]> {
  // Checked across every recent customer turn, not just the latest
  // message - the feature's own natural flow is two turns (the AI/prompt
  // effectively asks for an email, the customer replies with just the
  // email), and a bare "jane@example.com" reply wouldn't itself match an
  // account-question phrase. hasIdentifiableEmail below already scans
  // every turn for exactly this reason; the account-question check needs
  // the same breadth to actually reach the flow it's meant to serve.
  if (!customerTexts.some((text) => isAccountLookupQuestion(text))) {
    return [];
  }
  if (!hasIdentifiableEmail(customerTexts)) {
    return [];
  }
  const enabled = await isAiToolCallingEnabled(workspaceId);
  return enabled ? [LOOKUP_CONTACT_TOOL] : [];
}

interface ToolCallExecution {
  toolResult: AiToolResult;
  toolOutcome: "found" | "not_found" | "error";
}

/**
 * The one authorized, rate-limited, audited step of the bounded
 * two-call flow - isolated from generateAiReply so the authorization
 * chain (offered? valid args? customer-authorized email? under the
 * per-conversation cap?) reads as one linear sequence of early returns
 * instead of nested conditionals mixed into the caller's own control
 * flow.
 */
async function executeToolCall(
  workspaceId: string,
  conversationId: string,
  outcome: AiToolCallOutcome,
  toolsAvailable: AiToolName[],
  customerTexts: string[],
  deps: OrchestratorDeps,
): Promise<ToolCallExecution> {
  const rejected: ToolCallExecution = {
    toolResult: { tool: outcome.tool, found: false, error: "lookup_failed" },
    toolOutcome: "error",
  };

  // Defense in depth, not redundant: toolsAvailable is the Orchestrator's
  // own authorization decision (CLAUDE.md: the AI Service must never
  // make one itself). Both providers already restrict which tools they
  // offer/force based on toolsAvailable, but re-asserting it here means
  // a future provider bug can only ever produce a rejected tool_call,
  // never a live lookup a workspace never actually authorized.
  if (!toolsAvailable.includes(outcome.tool)) {
    return rejected;
  }

  const parsedArgs = lookupContactArgsSchema.safeParse(outcome.args);
  if (!parsedArgs.success) {
    return rejected;
  }

  // The email the tool actually runs against must be one the customer
  // themselves typed in this conversation - never one read out of
  // retrieved knowledge content, an earlier AI/system message, or
  // invented by the model. The system prompt already asks for this;
  // this is the server-side enforcement of it.
  const known = new Set(extractEmails(customerTexts).map((email) => email.toLowerCase()));
  if (!known.has(parsedArgs.data.email.toLowerCase())) {
    return rejected;
  }
  const authorizedEmail = parsedArgs.data.email;

  // The customer channel is anonymous by design (no login), so nothing
  // above actually verifies the visitor asking IS the person behind
  // authorizedEmail - only that they typed it. This caps how many
  // distinct probes one conversation can make, on top of the existing
  // per-conversation widget message rate limit (which bounds message
  // frequency, not lookup count specifically). Best-effort, not atomic:
  // a genuinely concurrent pair of qualifying messages in the same
  // conversation could each read this count before either's insert
  // lands, exceeding the cap by a small margin - accepted rather than
  // adding per-conversation locking for what is a secondary abuse
  // mitigation on top of the email-provenance check above, not the
  // primary safeguard.
  const priorLookups = await withWorkspaceContext(workspaceId, (scopedDb) =>
    countAiTriggeredLookups(scopedDb, workspaceId, conversationId),
  );
  if (priorLookups >= MAX_AI_TRIGGERED_LOOKUPS_PER_CONVERSATION) {
    return rejected;
  }

  // Executed via lookupContact's own try/catch-wrapped provider call,
  // then wrapped again here: a failed lookup (bad credential, HubSpot
  // down) must become a neutral tool result the model can react to
  // gracefully on the forced final call, not an exception that skips
  // straight to the generic ai_provider_error fallback - the customer
  // still gets a real, on-topic answer instead of a hard escalation for
  // what may just be "no matching contact."
  try {
    const contactResult = await lookupContact(workspaceId, conversationId, { type: "ai" }, authorizedEmail, deps);
    return {
      // Membership-only - see AiToolResult's own comment on why name/
      // email/company/lifecycleStage never reach the customer-facing
      // side of this tool, even though lookupContact's own audit log
      // entry still records the full result for the dashboard.
      toolResult: { tool: outcome.tool, found: contactResult.found },
      toolOutcome: contactResult.found ? "found" : "not_found",
    };
  } catch {
    // Never the caught error's own .message - see AiToolResult.error's
    // comment on why raw upstream error text must not reach the model.
    return rejected;
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

// Shared by all three call sites in generateAiReply that hit "there is
// nothing to ground a reply on" - the original pre-Stage-1 empty-
// retrieval path, and both of Stage 1's own equivalents (the tool path
// never producing grounding, whether or not the model actually tried
// it). Kept as one function so the deterministic fallback - the
// customer-facing message, the escalation reason, and the metadata
// shape - can't drift between the three sites.
async function escalateNoRelevantKnowledge(
  workspaceId: string,
  conversationId: string,
  detail: string,
  deps: OrchestratorDeps,
): Promise<void> {
  await recordEscalation(workspaceId, conversationId, { reason: "no_relevant_knowledge", detail }, deps);
  await sendSystemMessage(workspaceId, conversationId, NO_RELEVANT_KNOWLEDGE_MESSAGE, {
    escalated: true,
    escalationReason: "no_relevant_knowledge",
  });
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

  const outcome = await generateSupportReply(
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

  // This call site never sets toolsAvailable, so a real provider can
  // never actually return kind: "tool_call" here - narrowed defensively
  // because the return type is the same shared union generateAiReply's
  // tool-eligible call uses. `kind` is stripped so this route's response
  // shape is unchanged from before Stage 1.
  if (outcome.kind !== "reply") {
    return null;
  }
  const { kind: _kind, ...replyResult } = outcome;
  return replyResult;
}

export interface TestQuestionResult {
  // false when nothing cleared the relevance floor (or the provider
  // misbehaved) - the customer-facing equivalent is the deterministic
  // no_relevant_knowledge fallback, never a call to the model.
  grounded: boolean;
  reply?: string;
  confidence?: number;
  // The same decision generateAiReply makes before persisting: model
  // asked for a human, or confidence below the escalation threshold.
  needsEscalation?: boolean;
  citations?: Citation[];
  provider?: string;
  model?: string;
  promptVersion?: number;
  finishReason?: string;
}

/**
 * The pre-deployment test-question surface (docs/09 §V1.x): lets an
 * owner ask a real question against the live knowledge base and see the
 * exact answer/confidence/citations customers would get, before going
 * live - no conversation is created and nothing is persisted or
 * broadcast. Shares the same retrieval + generation pipeline as the
 * customer-facing path (searchKnowledge -> generateSupportReply) and the
 * same structural grounding guarantee (model is never called below
 * MIN_RELEVANCE_SIMILARITY). Reaches two modules (knowledge + AI), so it
 * lives here in the Orchestrator rather than in a route.
 */
export async function answerTestQuestion(
  workspaceId: string,
  question: string,
  deps: OrchestratorDeps = {},
): Promise<TestQuestionResult> {
  const workspace = await withWorkspaceContext(workspaceId, (scopedDb) => getWorkspaceById(scopedDb, workspaceId));
  if (!workspace) {
    throw new NotFoundError("answerTestQuestion: workspace not found.");
  }

  const relevantChunks = (
    await searchKnowledge(workspaceId, question, RETRIEVAL_LIMIT, deps.embeddingProvider)
  ).filter((chunk) => chunk.similarity >= MIN_RELEVANCE_SIMILARITY);

  if (relevantChunks.length === 0) {
    return { grounded: false };
  }

  const outcome = await generateSupportReply(
    {
      workspaceName: workspace.name,
      history: [],
      retrievedContext: relevantChunks.map((chunk) => ({
        knowledgeChunkId: chunk.id,
        knowledgeSourceId: chunk.knowledgeSourceId,
        content: chunk.content,
        similarity: chunk.similarity,
      })),
      customerMessage: question,
    },
    deps.aiProvider,
  );

  // No tools are ever offered here, so a real provider can't return a
  // tool_call - narrowed defensively the same way suggestReplyForAgent does.
  if (outcome.kind !== "reply") {
    return { grounded: false };
  }

  return {
    grounded: true,
    reply: outcome.reply,
    confidence: outcome.confidence,
    needsEscalation: outcome.needsEscalation || outcome.confidence < CONFIDENCE_ESCALATION_THRESHOLD,
    citations: outcome.citations,
    provider: outcome.provider,
    model: outcome.model,
    promptVersion: outcome.promptVersion,
    finishReason: outcome.finishReason,
  };
}

/**
 * The one summarize implementation both triggers share: the on-demand
 * /summarize route (regenerate) and the auto-fire on escalation
 * (recordEscalation -> autoSummarizeEscalation). See docs/09 §V1.x.
 */
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

/**
 * Fired by recordEscalation whenever a conversation escalates, so the
 * human taking over gets the full story without clicking "regenerate"
 * (docs/09 §V1.x: "Auto-fire the escalation summary at the moment of
 * escalation"). Best-effort: routed through JobRunner and wrapped in a
 * .catch at its call site, so a failure here can never break the
 * escalation itself. Reuses the exact same summarizeConversationForAgent
 * the on-demand /summarize route calls - only the trigger differs.
 *
 * The duplicate guard compares aiSummary.generatedAt against the current
 * escalation's escalatedAt (escalateConversation stamps that timestamp
 * on every escalation, and saveConversationSummary stamps generatedAt):
 * a summary generated at-or-after the escalation already reflects it, so
 * regenerating would be duplicate work for the same escalation. A later,
 * genuinely new escalation (a new escalatedAt) passes the guard and gets
 * a fresh summary. Exported so the deterministic tests can re-invoke the
 * trigger for the "same escalation" case; not routed anywhere itself.
 */
export async function autoSummarizeEscalation(
  workspaceId: string,
  conversationId: string,
  deps: OrchestratorDeps = {},
): Promise<void> {
  const conversation = await withWorkspaceContext(workspaceId, (scopedDb) =>
    getConversationById(scopedDb, workspaceId, conversationId),
  );
  if (!conversation) {
    return;
  }
  const metadata = conversation.metadata as
    | { escalation?: { escalatedAt?: string }; aiSummary?: { generatedAt?: string } }
    | null;
  const escalatedAt = metadata?.escalation?.escalatedAt;
  const summaryGeneratedAt = metadata?.aiSummary?.generatedAt;
  if (!escalatedAt || (summaryGeneratedAt && summaryGeneratedAt >= escalatedAt)) {
    return;
  }
  await summarizeConversationForAgent(workspaceId, conversationId, deps);
}

// --- Integration Service (Phase 5) ---

// Discriminates who's calling: a dashboard agent (existing Phase 5 flow,
// unchanged behavior) or the AI itself (Support Orchestrator Stage 1).
// Not a bare optional userId - an absent userId meaning "the AI did it"
// is exactly the overloaded-null ambiguity integration_action_logs'
// own triggeredBy enum was added to avoid (see that schema file's
// comment); the same explicitness carries through to this call site.
export type LookupContactTrigger = { type: "human"; userId: string } | { type: "ai" };

/**
 * Callable by a dashboard agent (docs/07's Phase 5 notes) or, as of
 * Stage 1, by the AI itself via generateAiReply's bounded tool-call
 * flow - trigger.type says which. A successful lookup is recorded as an
 * internal note (conversation_notes, agent-only) only for a human
 * trigger: conversation_notes.userId is NOT NULL by design (no
 * anonymous/system notes - see that schema file's comment), and there is
 * no user to attribute an AI-triggered note to. Deliberately scoped out
 * for Stage 1 rather than weakening that invariant; the AI's lookup
 * still reaches the customer through its own reply, it just doesn't
 * additionally get logged as a note to the agent.
 *
 * Every attempt is logged to integration_action_logs regardless of
 * outcome or trigger - the audit trail 02_Product_Blueprint.md requires
 * for the Act pillar ("every action must be secure, auditable, and
 * permission-controlled"). "No integration connected" is a precondition,
 * not a loggable action - it's rejected before this point, inside
 * integration.service.ts, since there's no integration row yet to
 * attribute a log entry to.
 */
export async function lookupContact(
  workspaceId: string,
  conversationId: string,
  trigger: LookupContactTrigger,
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
      actionName: CONTACT_LOOKUP_ACTION_NAME,
      requestParams: { email },
      resultStatus: outcome.result ? "success" : "failure",
      resultSummary: outcome.result
        ? outcome.result.found
          ? `Found contact: ${outcome.result.name ?? outcome.result.email}.`
          : "No matching contact found."
        : (outcome.errorMessage ?? "Unknown integration error."),
      triggeredBy: trigger.type,
      triggeredByUserId: trigger.type === "human" ? trigger.userId : null,
    }),
  );

  if (!outcome.result) {
    // Specific message is safe here - this route is dashboard-only,
    // never customer-facing, same allowance CLAUDE.md gives admin routes
    // generally. 502: the failure is upstream (the provider), not this API.
    // (The AI-triggered call site wraps this in its own try/catch - see
    // generateAiReply - so this throw never reaches the customer directly.)
    throw new AppError(`Contact lookup failed: ${outcome.errorMessage ?? "unknown error"}.`, 502);
  }

  if (outcome.result.found && trigger.type === "human") {
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
      insertConversationNote(scopedDb, { workspaceId, conversationId, userId: trigger.userId, content: summary }),
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

  const jobRunner = deps.jobRunner ?? getDefaultJobRunner();

  // Auto-fire the escalation summary (docs/09 §V1.x). Best-effort, like
  // the sync below: routed through JobRunner and swallowed with .catch so
  // a summarize failure can never break the escalation that just succeeded.
  // autoSummarizeEscalation's own guard keeps it from duplicating a summary
  // the same escalation already has.
  await jobRunner.run(() => autoSummarizeEscalation(workspaceId, conversationId, deps).catch(() => {}));

  const existingContact = await withWorkspaceContext(workspaceId, (scopedDb) =>
    getFullEscalationContactByConversationId(scopedDb, workspaceId, conversationId),
  );
  if (!existingContact) {
    return;
  }

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
