import type { AiToolResult, RetrievedContext } from "../ai-provider.js";

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
// v5: v4 still treated "no exact match" and "customer asked directly" as
// the same trigger for stating a limitation, so a direct "have you done
// X?" got answered with an upfront "no" before anything else - reading
// as an admission of weakness rather than a confident answer. Now only
// the customer asking about that *exact* thing (or omission being
// misleading) triggers stating a limitation; a general "have you done
// something like this?" gets answered by leading with whatever related
// experience the Knowledge Context does support, no explicit "no"
// needed. Never fabricates - unchanged from v4.
// v6: Support Orchestrator Stage 1 - when the Orchestrator's own
// deterministic eligibility gate offers lookup_contact, the system
// prompt now explains when/how to use it (buildToolsGuidance) and
// buildUserContent can append a Tool Result block. Both are additive
// and only present when toolsAvailable/toolResult are actually set -
// a call with neither behaves identically to v5. (A pre-ship security
// review tightened the failed/error-case wording in buildToolResultBlock
// to stay generic - AiToolResult.error is a closed neutral reason, never
// raw upstream error text - folded into v6 rather than a separate bump
// since this version never shipped.)
export const PROMPT_VERSION = 6;

export const LOOKUP_CONTACT_TOOL_NAME = "lookup_contact";
export const LOOKUP_CONTACT_TOOL_DESCRIPTION =
  "Look up the customer's own contact/account record by email address. Only returns identity fields (name, email, company, lifecycle stage) - never use it for anything other than confirming the customer's own account identity or status.";

export const LOOKUP_CONTACT_SCHEMA: {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
} = {
  type: "object",
  properties: {
    email: {
      type: "string",
      description: "The customer's own email address, taken from the conversation - never invented.",
    },
  },
  required: ["email"],
};

export interface LookupContactToolInput {
  email: string;
}

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

// Only appended when the Orchestrator's own eligibility gate
// (integration-lookup-phrases.ts) already decided this message is a
// plausible account-identity question with an email in context - this
// text explains how to use the tool once offered, it does not decide
// whether to offer it.
function buildToolsGuidance(toolsAvailable: readonly string[]): string {
  if (!toolsAvailable.includes(LOOKUP_CONTACT_TOOL_NAME)) return "";
  return `

You also have a ${LOOKUP_CONTACT_TOOL_NAME} tool available. Call it, instead of ${RESPOND_TO_CUSTOMER_TOOL_NAME}, only when the customer is asking about their own account/contact identity or status (e.g. "am I a customer", "what's my account status", "do you have my info on file") AND you can see their email address in the conversation. Never guess or invent an email - use only one that actually appears in the conversation. For anything else, including questions the Knowledge Context doesn't cover, answer normally with ${RESPOND_TO_CUSTOMER_TOOL_NAME} - do not use this tool as a substitute for knowledge you don't have.`;
}

export function buildSystemPrompt(workspaceName: string, toolsAvailable: readonly string[] = []): string {
  return `You are a customer support agent for ${workspaceName}, replying in a live chat.

You must answer ONLY using the information given to you in the "Knowledge Context" section of the user message. Do not use anything you know from your own training, and never invent or assume facts about ${workspaceName} - its products, services, experience, customers, or capabilities - beyond what the Knowledge Context actually states. If the Knowledge Context doesn't fully cover what's being asked, see "When the exact experience isn't in the Knowledge Context" below for how to handle that.

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

When the exact experience, case study, or capability isn't in the Knowledge Context:
- Never volunteer that it's missing. Lead with whatever relevant experience or capability the Knowledge Context does support, and keep the conversation moving - don't turn the reply into an admission of what you can't do.
- A general question like "have you done something like this?" doesn't need an explicit "no" - a natural answer built around what IS there is enough.
- State a specific limitation outright only when the customer asks about that exact thing directly, or leaving it unsaid would make your answer misleading. Even then, say it plainly and briefly and keep going - no apologizing, no over-explaining, nothing that makes the customer feel they should look elsewhere.
- Never invent experience, customers, products, capabilities, case studies, or achievements to fill the gap.

Other rules:
- Always respond by calling the ${RESPOND_TO_CUSTOMER_TOOL_NAME} tool - never send a plain chat message outside of it.
- Set "confidence" (0 to 1) to how well the provided Knowledge Context actually supports your answer - not how confident you are in your own wording. If the context is only tangentially related, use a low score.
- Set "needs_escalation" to true if the context is insufficient, the customer seems upset, or the request needs a human (e.g. an account-specific action, a refund approval, a complaint).
- In "cited_sources", list only the source numbers you actually relied on to write the reply. If you didn't use any, return an empty array.${buildToolsGuidance(toolsAvailable)}`;
}

// Rendered only on the second call of the bounded two-call flow, after
// the Orchestrator has actually executed lookup_contact. Deliberately
// terse and factual - the system prompt's tools guidance already told
// the model how to use this, this block just states what came back.
function buildToolResultBlock(toolResult?: AiToolResult): string {
  if (!toolResult) return "";
  if (toolResult.error) {
    // Deliberately generic - toolResult.error is a closed neutral
    // reason, never raw upstream error text (see AiToolResult's own
    // comment), so there is nothing more specific it would be safe to
    // say here anyway.
    return `\n\nTool Result (${toolResult.tool}): the lookup could not be completed right now. Answer the customer honestly - don't claim to have found or not found their account, and don't speculate about why it failed.`;
  }
  if (!toolResult.found) {
    return `\n\nTool Result (${toolResult.tool}): no matching contact was found. Answer the customer honestly - don't claim to have found their account.`;
  }
  // Deliberately membership-only - see AiToolResult's own comment on why
  // this doesn't carry name/company/lifecycle stage. Simply confirm the
  // match; never state or guess any further detail about the account.
  return `\n\nTool Result (${toolResult.tool}): a matching contact was found for that email. Simply confirm to the customer that we do have a record for that email - do not state or guess their name, company, plan, lifecycle stage, or any other detail; you were not given any.`;
}

export function buildUserContent(
  history: { senderType: string; content: string }[],
  retrievedContext: RetrievedContext[],
  customerMessage: string,
  pageContext?: { url: string; title: string },
  toolResult?: AiToolResult,
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
${contextBlock}${pageContextBlock}${buildToolResultBlock(toolResult)}

Customer's latest message: ${customerMessage}`;
}
