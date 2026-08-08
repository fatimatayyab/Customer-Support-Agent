import { env } from "../../config/env.js";
import type { AiProvider, AiReplyResult, GenerateReplyInput, SummarizeInput, SummarizeResult } from "./ai-provider.js";
import { AnthropicAiProvider } from "./providers/anthropic-ai-provider.js";
import { GeminiAiProvider } from "./providers/gemini-ai-provider.js";

// Configuration-driven per AI_PROVIDER (env.ts), not a hardcoded class -
// this is the one place that knows both provider classes exist. Every
// other module, including the Support Orchestrator, only ever sees
// generateSupportReply() below and the provider-neutral types it
// returns. Adding a third provider means one new file under providers/
// and one new case here - nothing else in the codebase changes.
function createAiProvider(): AiProvider {
  switch (env.AI_PROVIDER) {
    case "gemini":
      return new GeminiAiProvider();
    case "anthropic":
      return new AnthropicAiProvider();
  }
}

// Lazily constructed, not built at import time: constructing a provider
// touches its SDK client (and, for some providers, its API key) as a
// side effect, which previously ran the moment this module was
// imported for any reason, including importing it just for its types.
// Cached after first use so a caller that doesn't pass its own
// provider doesn't pay construction cost more than once.
let defaultAiProvider: AiProvider | undefined;
function getDefaultAiProvider(): AiProvider {
  return (defaultAiProvider ??= createAiProvider());
}

// The `provider` parameter is real dependency injection, not a testing
// convenience bolted on: it's also the exact shape a future per-workspace
// AI Configuration entity needs (docs/07's tech-debt note) - whatever
// resolves "which provider for this workspace" will call this with an
// explicit provider instead of relying on the env-var-selected default.
export function generateSupportReply(
  input: GenerateReplyInput,
  provider: AiProvider = getDefaultAiProvider(),
): Promise<AiReplyResult> {
  return provider.generateReply(input);
}

export function summarizeConversationHistory(
  input: SummarizeInput,
  provider: AiProvider = getDefaultAiProvider(),
): Promise<SummarizeResult> {
  return provider.summarize(input);
}

export type { AiReplyResult, ConversationTurn, Citation, RetrievedContext, SummarizeResult } from "./ai-provider.js";
