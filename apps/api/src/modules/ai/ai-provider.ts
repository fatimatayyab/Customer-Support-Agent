import { AppError } from "../../errors.js";

/**
 * Abstraction over whatever generates a support reply, mirroring
 * EmbeddingProvider from Phase 2. Two implementations exist today
 * (providers/gemini-ai-provider.ts, providers/anthropic-ai-provider.ts),
 * selected in ai.service.ts by the AI_PROVIDER env var - nothing
 * outside this module should import either class directly. Per
 * 03_System_Architecture.md / 05_Engineering_Bible.md: this layer
 * understands intent, generates responses, and scores confidence - it
 * never touches the database, never makes authorization decisions, and
 * never calls a third party other than the model provider itself.
 */

export interface RetrievedContext {
  knowledgeChunkId: string;
  knowledgeSourceId: string;
  content: string;
  similarity: number;
}

export interface ConversationTurn {
  senderType: "customer" | "agent" | "system" | "ai";
  content: string;
}

// The one tool the AI Service knows how to describe today (Support
// Orchestrator Stage 1). Deliberately a closed string union, not a
// generic string - "wait for the second real use case" (CLAUDE.md)
// applies to tool names exactly like it does to providers/integrations.
export type AiToolName = "lookup_contact";

// A runtime value for the one member of AiToolName, so a consumer
// outside this module (support-orchestrator.ts) can reference the tool
// by name without hand-typing the string literal at every call site -
// the day a second tool name is added, every one of those call sites
// still needs a real decision, not a silently-still-valid old string.
export const LOOKUP_CONTACT_TOOL: AiToolName = "lookup_contact";

// Neutral, AI-module-local shape - NOT a re-export of the Integrations
// module's ContactLookupResult. The AI Service must never import from
// modules/integrations (03_System_Architecture.md's module boundaries),
// so the Orchestrator translates the real result into this narrower
// shape before it goes back into a second generateReply call.
//
// Deliberately membership-only (found: boolean), no name/email/company/
// lifecycleStage - a security review flagged that this tool answers an
// UNVERIFIED claim (customers are anonymous by design; nothing confirms
// the email typed in chat belongs to whoever's typing), so anything
// beyond a bare yes/no would let anyone who knows or guesses a real
// customer's email have that person's CRM details read back to them.
// The full record is still visible where it belongs - the dashboard,
// via the existing agent-triggered lookup and integration_action_logs.
export interface AiToolResult {
  tool: "lookup_contact";
  found: boolean;
  // Closed, neutral reason - never raw upstream/provider error text. A
  // failed HubSpot call or a credential-decryption error must never
  // reach the model's user-content, since the model paraphrases this
  // into a customer-facing reply; the specific cause still goes into
  // integration_action_logs.resultSummary (dashboard-only) instead.
  error?: "lookup_failed";
}

export interface GenerateReplyInput {
  workspaceName: string;
  history: ConversationTurn[];
  retrievedContext: RetrievedContext[];
  customerMessage: string;
  // The website widget's context signal (docs/00/02's Chat Widget
  // direction: current page URL/title, nothing more) - deliberately not
  // named/shaped as a generic cross-channel "context" field. A future
  // channel (messaging, voice) defines and adds its own, it doesn't
  // reuse or generalize this one.
  pageContext?: { url: string; title: string };
  // Set by the Orchestrator only when its own deterministic eligibility
  // gate (integration-lookup-phrases.ts) passes - never derived here.
  // Absent/empty means exactly what it does today: only
  // respond_to_customer is offered.
  toolsAvailable?: AiToolName[];
  // Present only on the second call of the bounded two-call flow, once
  // the Orchestrator has actually executed the tool the model
  // requested on the first call. Its presence is what tells a provider
  // implementation to force respond_to_customer instead of offering
  // lookup_contact again - this is a strictly bounded one-round
  // tool-use flow, not a general agent loop.
  toolResult?: AiToolResult;
}

export interface Citation {
  knowledgeChunkId: string;
  knowledgeSourceId: string;
  similarity: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiReplyResult {
  reply: string;
  confidence: number;
  needsEscalation: boolean;
  citations: Citation[];
  // Which provider actually answered ("anthropic", "gemini", ...) - set
  // by each provider implementation itself, not assumed by any caller.
  // The Orchestrator persists this verbatim into message metadata; it
  // must never hardcode a provider name, or that record silently lies
  // the moment AI_PROVIDER points somewhere else.
  provider: string;
  model: string;
  // The PROMPT_VERSION (prompts/support-reply.prompt.ts) actually used
  // for this call - reported by the provider itself for the same reason
  // `provider` is, even though both providers happen to import the same
  // prompt file today: a caller should never assume which version ran.
  promptVersion: number;
  usage: AiUsage;
  finishReason: string;
}

// The model requested lookup_contact on the first call instead of
// answering directly. Carries only what the Orchestrator needs to
// execute the tool and to still record provider/model/promptVersion/
// usage for that call, even though no reply was produced by it.
export interface AiToolCallOutcome {
  kind: "tool_call";
  tool: "lookup_contact";
  args: { email: string };
  provider: string;
  model: string;
  promptVersion: number;
  usage: AiUsage;
}

// Discriminated union: every existing caller that only ever sent
// toolsAvailable=[] (i.e. never offered the tool) can only ever receive
// { kind: "reply" }, but the type doesn't encode that - callers that
// don't set toolsAvailable must still narrow on `kind` defensively.
export type GenerateReplyOutcome = ({ kind: "reply" } & AiReplyResult) | AiToolCallOutcome;

export interface SummarizeInput {
  workspaceName: string;
  history: ConversationTurn[];
}

export interface SummarizeResult {
  summary: string;
  provider: string;
  model: string;
  promptVersion: number;
  usage: AiUsage;
}

export interface AiProvider {
  generateReply(input: GenerateReplyInput): Promise<GenerateReplyOutcome>;
  summarize(input: SummarizeInput): Promise<SummarizeResult>;
}

// Shared across providers rather than one class per provider - the
// only thing that differs is which env var name to point at in the
// message. Not customer-facing (only the Orchestrator's internal
// fallback path sees this), so naming the exact env var is fine.
export class AiProviderNotConfiguredError extends AppError {
  constructor(envVarName: string) {
    super(`AI replies are not configured yet - set ${envVarName} on the API.`, 503);
  }
}
