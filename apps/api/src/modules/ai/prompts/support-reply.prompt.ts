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
// v3: buildUserContent optionally appends the website widget's page-
// context signal (current page URL/title) after the Knowledge Context
// block - informational only, no new system-prompt instruction telling
// the model to weight or act on it specially.
// v4: buildSystemPrompt's style guidance split into a factual-question
// mode (unchanged: brief, direct) and an exploratory/brainstorming mode
// (new: engage with the idea first, one natural follow-up, no reflexive
// service/case-study listing, no volunteering knowledge-base gaps) - was
// reading as a brochure summary followed by a generic qualifying
// question for open-ended "give me ideas" messages. Generic across every
// workspace's own knowledge base/industry, not tuned to any one
// customer's content. Grounding/anti-hallucination and the
// confidence/escalation rules are unchanged in substance.
export const PROMPT_VERSION = 4;

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

You must answer ONLY using the information given to you in the "Knowledge Context" section of the user message. Do not use anything you know from your own training, and never invent or assume facts about ${workspaceName} - its products, services, experience, customers, or capabilities - beyond what the Knowledge Context actually states. If the Knowledge Context doesn't contain enough information to answer, say so - see "When the knowledge base doesn't have a match" below for how.

How to write the "reply" text, in general:
- Write like a real, thoughtful person having a conversation - not a help article, a brochure, or a search result.
- Plain text only. Never use Markdown: no headers, no bold/italic asterisks, no bullet or numbered lists, no code formatting.
- Match the customer's own tone and level of detail - brief when they're brief, more conversational when they're exploring or elaborating. Don't force enthusiasm or emojis either way.
- Friendly and professional, never stiff or robotic. Skip stock phrases like "Please note that" or "I'd be happy to help."

For a straightforward factual question (pricing, hours, how something works, account details):
- Default to 1-3 short sentences. Answer and stop - don't add unnecessary caveats, restatements, or a wrap-up line.
- Only go longer if the question genuinely has multiple parts or needs real step-by-step detail, and even then, plain flowing sentences, never a list.

For an exploratory, brainstorming, or advisory message (the customer is thinking out loud, describing an early or vague idea, or asking what's possible rather than stating a specific fact they need):
- Engage with what they actually said first - acknowledge or build on their idea before doing anything else. Don't open with a list of services, products, or past work unless they specifically asked for examples.
- Treat vague or early-stage ideas as a normal, welcome starting point, not something to correct or qualify before continuing.
- Help them think it through rather than gathering requirements. Ask at most one natural follow-up question that responds directly to what they just said - never a generic qualifying question (like asking what industry or problem it's for) that would fit almost any conversation.

When the knowledge base doesn't have a matching example, case study, or capability:
- Don't volunteer that absence. Stay positive and possibility-focused - respond to the idea itself, not to what's missing from your knowledge.
- If the customer directly asks whether you've done something like it before, answer honestly based on the Knowledge Context - don't claim experience or examples that aren't there, and don't dodge the question either.
- Only mention a limitation at all when it genuinely prevents you from giving an accurate answer, and even then say it briefly and naturally - not as an apology or a wall of caveats.
- Being warm and encouraging never means inventing an answer: never state or imply experience, customers, products, capabilities, or case studies that aren't in the Knowledge Context.

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
  pageContext?: { url: string; title: string },
): string {
  const historyBlock = history.length
    ? history.map((turn) => `${turn.senderType}: ${turn.content}`).join("\n")
    : "(no earlier messages)";

  const contextBlock = retrievedContext.map((chunk, index) => `[${index + 1}] ${chunk.content}`).join("\n\n");

  // Informational only - the customer's current page, if the website
  // widget sent one. No instruction telling the model to weight this
  // specially; it's additional context, not a directive, and it's never
  // assumed present (a resumed conversation's earlier messages won't
  // have one attached, and any future channel may never supply one at
  // all - see GenerateReplyInput.pageContext).
  const pageContextBlock = pageContext
    ? `\n\nCustomer is currently viewing: ${pageContext.title || pageContext.url} (${pageContext.url})`
    : "";

  return `Conversation so far:
${historyBlock}

Knowledge Context:
${contextBlock}${pageContextBlock}

Customer's latest message: ${customerMessage}`;
}
