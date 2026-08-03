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

export interface GenerateReplyInput {
  workspaceName: string;
  history: ConversationTurn[];
  retrievedContext: RetrievedContext[];
  customerMessage: string;
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
  generateReply(input: GenerateReplyInput): Promise<AiReplyResult>;
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
