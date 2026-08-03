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

const aiProvider: AiProvider = createAiProvider();

export function generateSupportReply(input: GenerateReplyInput): Promise<AiReplyResult> {
  return aiProvider.generateReply(input);
}

export function summarizeConversationHistory(input: SummarizeInput): Promise<SummarizeResult> {
  return aiProvider.summarize(input);
}

export type { AiReplyResult, ConversationTurn, Citation, RetrievedContext, SummarizeResult } from "./ai-provider.js";
