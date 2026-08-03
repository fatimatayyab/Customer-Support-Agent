import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../../config/env.js";
import { AiProviderNotConfiguredError, type AiProvider, type AiReplyResult, type GenerateReplyInput } from "../ai-provider.js";
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

const MODEL = "claude-haiku-4-5-20251001";

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

  async generateReply(input: GenerateReplyInput): Promise<AiReplyResult> {
    const client = this.getClient();

    const tool: Anthropic.Tool = {
      name: RESPOND_TO_CUSTOMER_TOOL_NAME,
      description: RESPOND_TO_CUSTOMER_TOOL_DESCRIPTION,
      input_schema: RESPOND_TO_CUSTOMER_SCHEMA,
    };

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: buildSystemPrompt(input.workspaceName),
      messages: [
        {
          role: "user",
          content: buildUserContent(input.history, input.retrievedContext, input.customerMessage),
        },
      ],
      tools: [tool],
      tool_choice: { type: "tool", name: RESPOND_TO_CUSTOMER_TOOL_NAME },
    });

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");

    if (!toolUse) {
      throw new Error("Claude did not return a tool_use block for respond_to_customer.");
    }

    // Trust the shape here: tool_choice forces exactly this tool, and its
    // input_schema is the schema Claude was given to fill in.
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
}
