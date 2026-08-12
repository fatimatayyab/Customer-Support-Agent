import type { RetrievedContext } from "../ai-provider.js";

/**
 * Everything a provider needs to ask a model for a structured support
 * reply lives here, as plain data - not in either provider's own file.
 * Prompt wording and schema fields change for different reasons than
 * API-calling mechanics do, and this is the one file a prompt-quality
 * pass edits regardless of which provider is active.
 *
 * RESPOND_TO_CUSTOMER_SCHEMA is deliberately a plain JSON Schema object
 * (standard lowercase types), not an SDK-specific shape - Anthropic's
 * Tool.input_schema and Gemini's FunctionDeclaration.parametersJsonSchema
 * both accept this exact format directly, with zero conversion. That's
 * what "the same schema, minimal changes to add a provider" means in
 * practice: one object, two providers, no per-provider translation step.
 */

// Bump whenever buildSystemPrompt/buildUserContent/RESPOND_TO_CUSTOMER_SCHEMA
// change in a way that could affect reply quality - each provider reports
// this back in AiReplyResult, so it lands in messages.metadata and gives a
// way to correlate a reply's behavior with which prompt version produced
// it (e.g. when comparing quality before/after a wording change).
//
// v2: rewrote the style guidance (see buildSystemPrompt) to fix replies
// reading as long, markdown-formatted, and AI-assistant-voiced instead
// of a short, plain-text, human-agent-sounding chat message.
export const PROMPT_VERSION = 2;

export const RESPOND_TO_CUSTOMER_TOOL_NAME = "respond_to_customer";
export const RESPOND_TO_CUSTOMER_TOOL_DESCRIPTION =
  "Provide a structured response to the customer's support question.";

// Deliberately not `as const`: both SDKs' schema fields accept this as
// a loosely-typed passthrough object, and a readonly tuple for
// `required` doesn't assign cleanly to either SDK's mutable string[].
export const RESPOND_TO_CUSTOMER_SCHEMA: {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
} = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "The reply to send to the customer.",
    },
    confidence: {
      type: "number",
      description: "0 to 1: how well the provided Knowledge Context supports this answer.",
    },
    needs_escalation: {
      type: "boolean",
      description: "True if this conversation should be handed off to a human agent.",
    },
    cited_sources: {
      type: "array",
      items: { type: "integer" },
      description: "The source numbers from the Knowledge Context that were actually used, if any.",
    },
  },
  required: ["reply", "confidence", "needs_escalation", "cited_sources"],
};

export interface RespondToCustomerToolInput {
  reply: string;
  confidence: number;
  needs_escalation: boolean;
  cited_sources: number[];
}

export function buildSystemPrompt(workspaceName: string): string {
  return `You are a customer support agent for ${workspaceName}, replying in a live chat.

You must answer ONLY using the information given to you in the "Knowledge Context" section of the user message. Do not use anything you know from your own training - if the Knowledge Context doesn't contain enough information to answer, say so honestly and let the customer know a team member will follow up. Never guess, and never fill gaps with general knowledge, even if you're confident it's correct.

How to write the "reply" text:
- Write like a real, friendly support agent typing a live chat message - not a help article, a document, or an AI assistant.
- Plain text only. Never use Markdown: no headers, no bold/italic asterisks, no bullet or numbered lists, no code formatting.
- Default to 1-3 short sentences. Answer the question and stop - don't add unnecessary caveats, restatements, or a wrap-up line.
- Only write more than that if the question genuinely has multiple distinct parts or needs real step-by-step detail - and even then, say it in plain flowing sentences, never a list.
- Friendly and professional, never stiff or robotic. Skip stock phrases like "Please note that" or "I'd be happy to help."

Other rules:
- Always respond by calling the ${RESPOND_TO_CUSTOMER_TOOL_NAME} tool - never send a plain chat message outside of it.
- Set "confidence" (0 to 1) to how well the provided Knowledge Context actually supports your answer - not how confident you are in your own wording. If the context is only tangentially related, use a low score.
- Set "needs_escalation" to true if the context is insufficient, the customer seems upset, or the request needs a human (e.g. an account-specific action, a refund approval, a complaint).
- In "cited_sources", list only the source numbers you actually relied on to write the reply. If you didn't use any, return an empty array.`;
}

export function buildUserContent(
  history: { senderType: string; content: string }[],
  retrievedContext: RetrievedContext[],
  customerMessage: string,
): string {
  const historyBlock = history.length
    ? history.map((turn) => `${turn.senderType}: ${turn.content}`).join("\n")
    : "(no earlier messages)";

  const contextBlock = retrievedContext.map((chunk, index) => `[${index + 1}] ${chunk.content}`).join("\n\n");

  return `Conversation so far:
${historyBlock}

Knowledge Context:
${contextBlock}

Customer's latest message: ${customerMessage}`;
}
