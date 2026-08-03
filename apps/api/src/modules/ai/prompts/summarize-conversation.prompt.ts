/**
 * Deliberately simpler than support-reply.prompt.ts: a summary is plain
 * text handed straight to an agent, not a structured, tool-forced
 * response with confidence/citations/escalation semantics - forcing
 * that shape onto a summary would be complexity this capability doesn't
 * need. Scope note: only conversation messages are summarized, not
 * conversation_notes - internal notes aren't fed to the AI in this
 * phase, a deliberate boundary, not an oversight.
 */

export const SUMMARIZE_PROMPT_VERSION = 1;

export function buildSummarizeSystemPrompt(workspaceName: string): string {
  return `You summarize customer support conversations for ${workspaceName}'s support agents, so an agent can get up to speed in a few seconds before taking over.

Write 2-4 concise sentences covering: what the customer wants, what's already been said or tried, and anything the agent should know before responding (e.g. the customer seems frustrated, a specific order/account is involved, the AI couldn't fully resolve it). Do not include pleasantries or restate the whole conversation - just what a busy agent actually needs.`;
}

export function buildSummarizeUserContent(history: { senderType: string; content: string }[]): string {
  const historyBlock = history.length
    ? history.map((turn) => `${turn.senderType}: ${turn.content}`).join("\n")
    : "(no messages yet)";

  return `Conversation to summarize:\n${historyBlock}`;
}
