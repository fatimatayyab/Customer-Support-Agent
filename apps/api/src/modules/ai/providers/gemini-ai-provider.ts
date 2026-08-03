import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import { env } from "../../../config/env.js";
import {
  AiProviderNotConfiguredError,
  type AiProvider,
  type AiReplyResult,
  type GenerateReplyInput,
  type SummarizeInput,
  type SummarizeResult,
} from "../ai-provider.js";
import { MAX_OUTPUT_TOKENS } from "../ai.config.js";
import {
  buildSystemPrompt,
  buildUserContent,
  PROMPT_VERSION,
  RESPOND_TO_CUSTOMER_SCHEMA,
  RESPOND_TO_CUSTOMER_TOOL_DESCRIPTION,
  RESPOND_TO_CUSTOMER_TOOL_NAME,
  type RespondToCustomerToolInput,
} from "../prompts/support-reply.prompt.js";
import { buildSummarizeSystemPrompt, buildSummarizeUserContent, SUMMARIZE_PROMPT_VERSION } from "../prompts/summarize-conversation.prompt.js";

// Free-tier friendly - the default AI_PROVIDER for local/dev work
// specifically to avoid depending on a paid API before it's needed.
//
// Deliberately a floating alias, not a dated pin like Anthropic's
// provider: a dated Gemini model id we tried here (gemini-2.5-flash)
// was rejected outright for new API keys ("no longer available to new
// users") well before its usual deprecation timeline. This provider's
// whole purpose is cheap dev-stage iteration, not reproducibility -
// Google's own "-latest" alias exists specifically so callers don't
// have to chase model rotations by hand.
const MODEL = "gemini-flash-latest";

export class GeminiAiProvider implements AiProvider {
  private client: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    if (!env.GEMINI_API_KEY) {
      throw new AiProviderNotConfiguredError("GEMINI_API_KEY");
    }
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    }
    return this.client;
  }

  async generateReply(input: GenerateReplyInput): Promise<AiReplyResult> {
    const client = this.getClient();

    const response = await client.models.generateContent({
      model: MODEL,
      contents: buildUserContent(input.history, input.retrievedContext, input.customerMessage),
      config: {
        systemInstruction: buildSystemPrompt(input.workspaceName),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        tools: [
          {
            functionDeclarations: [
              {
                name: RESPOND_TO_CUSTOMER_TOOL_NAME,
                description: RESPOND_TO_CUSTOMER_TOOL_DESCRIPTION,
                // Same plain JSON Schema object Anthropic's provider uses
                // as input_schema - Gemini accepts standard JSON Schema
                // directly via this field, no conversion needed.
                parametersJsonSchema: RESPOND_TO_CUSTOMER_SCHEMA,
              },
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [RESPOND_TO_CUSTOMER_TOOL_NAME],
          },
        },
      },
    });

    const functionCall = response.functionCalls?.[0];
    if (!functionCall?.args) {
      throw new Error("Gemini did not return a function call for respond_to_customer.");
    }

    const parsed = functionCall.args as unknown as RespondToCustomerToolInput;

    const citations = parsed.cited_sources
      .map((sourceNumber) => input.retrievedContext[sourceNumber - 1])
      .filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== undefined)
      .map((chunk) => ({
        knowledgeChunkId: chunk.knowledgeChunkId,
        knowledgeSourceId: chunk.knowledgeSourceId,
        similarity: chunk.similarity,
      }));

    return {
      reply: parsed.reply,
      confidence: parsed.confidence,
      needsEscalation: parsed.needs_escalation,
      citations,
      provider: "gemini",
      model: response.modelVersion ?? MODEL,
      promptVersion: PROMPT_VERSION,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      finishReason: response.candidates?.[0]?.finishReason ?? "unknown",
    };
  }

  async summarize(input: SummarizeInput): Promise<SummarizeResult> {
    const client = this.getClient();

    const response = await client.models.generateContent({
      model: MODEL,
      contents: buildSummarizeUserContent(input.history),
      config: {
        systemInstruction: buildSummarizeSystemPrompt(input.workspaceName),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Gemini did not return text for summarize.");
    }

    return {
      summary: text.trim(),
      provider: "gemini",
      model: response.modelVersion ?? MODEL,
      promptVersion: SUMMARIZE_PROMPT_VERSION,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
