import Anthropic from "@anthropic-ai/sdk";
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

const MODEL = "claude-haiku-4-5-20251001";

// Neither the SDK's own default (~10 min) nor an unbounded hang is
// acceptable for a customer-facing chat reply - a hung call previously
// left the widget's typing indicator stuck with no resolution in sight.
const REQUEST_TIMEOUT_MS = 20_000;

export class AnthropicAiProvider implements AiProvider {
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!env.ANTHROPIC_API_KEY) {
      throw new AiProviderNotConfiguredError("ANTHROPIC_API_KEY");
    }
    if (!this.client) {
      this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    }
    return this.client;
  }

  async generateReply(input: GenerateReplyInput): Promise<GenerateReplyOutcome> {
    const client = this.getClient();

    const respondTool: Anthropic.Tool = {
      name: RESPOND_TO_CUSTOMER_TOOL_NAME,
      description: RESPOND_TO_CUSTOMER_TOOL_DESCRIPTION,
      input_schema: RESPOND_TO_CUSTOMER_SCHEMA,
    };

    // The second call of the bounded two-call flow (toolResult already
    // present) always forces respond_to_customer - lookup_contact is
    // never offered again, so this can't loop.
    const offerLookup = !input.toolResult && (input.toolsAvailable ?? []).includes("lookup_contact");
    const tools: Anthropic.Tool[] = offerLookup
      ? [
          respondTool,
          {
            name: LOOKUP_CONTACT_TOOL_NAME,
            description: LOOKUP_CONTACT_TOOL_DESCRIPTION,
            input_schema: LOOKUP_CONTACT_SCHEMA,
          },
        ]
      : [respondTool];

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: buildSystemPrompt(input.workspaceName, offerLookup ? [LOOKUP_CONTACT_TOOL_NAME] : []),
      messages: [
        {
          role: "user",
          content: buildUserContent(
            input.history,
            input.retrievedContext,
            input.customerMessage,
            input.pageContext,
            input.toolResult,
          ),
        },
      ],
      tools,
      // "any" (not "auto"): still forces a tool call every time - the
      // model just picks which of the two, rather than being allowed to
      // fall back to a plain text message outside the schema.
      tool_choice: offerLookup ? { type: "any" } : { type: "tool", name: RESPOND_TO_CUSTOMER_TOOL_NAME },
    }, { timeout: REQUEST_TIMEOUT_MS });

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");

    if (!toolUse) {
      throw new Error("Claude did not return a tool_use block for respond_to_customer.");
    }

    if (toolUse.name === LOOKUP_CONTACT_TOOL_NAME) {
      // toolUse.input is untyped SDK output, not guaranteed to match
      // LookupContactToolInput's shape even though tool_choice forced
      // this tool - never throw on missing/malformed output here: pass
      // "" through and let the Orchestrator's own zod validation
      // (lookupContactArgsSchema) reject it into the graceful
      // lookup_failed path instead of an ai_provider_error escalation.
      const parsed = toolUse.input as Partial<LookupContactToolInput>;
      return {
        kind: "tool_call",
        tool: "lookup_contact",
        args: { email: typeof parsed.email === "string" ? parsed.email : "" },
        provider: "anthropic",
        model: response.model,
        promptVersion: PROMPT_VERSION,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    }

    // Trust the shape here: tool_choice forces one of the declared
    // tools, and its input_schema is the schema Claude was given to
    // fill in.
    const parsed = toolUse.input as RespondToCustomerToolInput;

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
      provider: "anthropic",
      model: response.model,
      promptVersion: PROMPT_VERSION,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      finishReason: response.stop_reason ?? "unknown",
    };
  }

  async summarize(input: SummarizeInput): Promise<SummarizeResult> {
    const client = this.getClient();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: buildSummarizeSystemPrompt(input.workspaceName),
      messages: [{ role: "user", content: buildSummarizeUserContent(input.history) }],
    }, { timeout: REQUEST_TIMEOUT_MS });

    const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
    if (!textBlock) {
      throw new Error("Claude did not return a text block for summarize.");
    }

    return {
      summary: textBlock.text.trim(),
      provider: "anthropic",
      model: response.model,
      promptVersion: SUMMARIZE_PROMPT_VERSION,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
