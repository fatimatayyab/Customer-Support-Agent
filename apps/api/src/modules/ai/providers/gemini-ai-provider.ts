import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import { env } from "../../../config/env.js";
import {
  AiProviderNotConfiguredError,
  type AiProvider,
  type GenerateReplyInput,
  type GenerateReplyOutcome,
  type SummarizeInput,
  type SummarizeResult,
} from "../ai-provider.js";
import { MAX_OUTPUT_TOKENS } from "../ai.config.js";
import {
  buildSystemPrompt,
  buildUserContent,
  LOOKUP_CONTACT_SCHEMA,
  LOOKUP_CONTACT_TOOL_DESCRIPTION,
  LOOKUP_CONTACT_TOOL_NAME,
  PROMPT_VERSION,
  RESPOND_TO_CUSTOMER_SCHEMA,
  RESPOND_TO_CUSTOMER_TOOL_DESCRIPTION,
  RESPOND_TO_CUSTOMER_TOOL_NAME,
  type LookupContactToolInput,
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

// See the matching constant in anthropic-ai-provider.ts - a hung call
// otherwise leaves the widget's typing indicator stuck indefinitely.
const REQUEST_TIMEOUT_MS = 20_000;

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

  async generateReply(input: GenerateReplyInput): Promise<GenerateReplyOutcome> {
    const client = this.getClient();

    // Second call of the bounded two-call flow (toolResult already
    // present) always forces respond_to_customer only - lookup_contact
    // is never offered again, so this can't loop.
    const offerLookup = !input.toolResult && (input.toolsAvailable ?? []).includes("lookup_contact");
    const allowedFunctionNames = offerLookup
      ? [RESPOND_TO_CUSTOMER_TOOL_NAME, LOOKUP_CONTACT_TOOL_NAME]
      : [RESPOND_TO_CUSTOMER_TOOL_NAME];

    const response = await client.models.generateContent({
      model: MODEL,
      contents: buildUserContent(
        input.history,
        input.retrievedContext,
        input.customerMessage,
        input.pageContext,
        input.toolResult,
      ),
      config: {
        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
        systemInstruction: buildSystemPrompt(input.workspaceName, offerLookup ? [LOOKUP_CONTACT_TOOL_NAME] : []),
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
              ...(offerLookup
                ? [
                    {
                      name: LOOKUP_CONTACT_TOOL_NAME,
                      description: LOOKUP_CONTACT_TOOL_DESCRIPTION,
                      parametersJsonSchema: LOOKUP_CONTACT_SCHEMA,
                    },
                  ]
                : []),
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames,
          },
        },
      },
    });

    const functionCall = response.functionCalls?.[0];
    if (!functionCall?.args) {
      throw new Error("Gemini did not return a function call for respond_to_customer.");
    }

    if (functionCall.name === LOOKUP_CONTACT_TOOL_NAME) {
      // functionCall.args is untyped SDK output - never throw on
      // missing/malformed output here: pass "" through and let the
      // Orchestrator's own zod validation (lookupContactArgsSchema)
      // reject it into the graceful lookup_failed path instead of an
      // ai_provider_error escalation.
      const parsed = functionCall.args as unknown as Partial<LookupContactToolInput>;
      return {
        kind: "tool_call",
        tool: "lookup_contact",
        args: { email: typeof parsed.email === "string" ? parsed.email : "" },
        provider: "gemini",
        model: response.modelVersion ?? MODEL,
        promptVersion: PROMPT_VERSION,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
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
      kind: "reply",
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
        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
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
