/**
 * Deliberately conservative, deterministic phrase matching - not model-based
 * intent classification. Runs before knowledge retrieval in generateAiReply
 * (support-orchestrator.ts) specifically because a bare "talk to a human"
 * message usually retrieves zero relevant knowledge chunks and would
 * otherwise be swallowed by the no_relevant_knowledge escalation path
 * before the model ever sees it.
 *
 * Precision over recall by design: this widget is embedded across every
 * vertical the platform targets, several of which use "agent"/"person" as
 * an ordinary job title (real estate agent, travel agent, insurance
 * agent) or common noun ("the person who placed the order"). Every
 * pattern below requires a clear request verb (talk/speak/connect/etc.)
 * adjacent to the target noun, not just the word's bare presence - a
 * missed request degrades gracefully (the normal AI/confidence escalation
 * path still catches it eventually), a false positive does not.
 */

const ARTICLE = "((a|an)\\s+)?";
// "talk"/"speak" just add -ing; "chat" doubles the consonant ("chatting",
// not "chating") - a single shared `(talk|speak|chat)(ing)?` alternation
// silently never matches the real gerund of the third verb.
const TALK_VERB = "(talk(ing)?|speak(ing)?|chat(ting)?)";
// Word-boundary alone lets a following hyphen count as a boundary too
// ("human-readable" would otherwise match "...a human" as a request) -
// the negative lookahead rejects the noun being the first half of a
// compound/hyphenated word.
const NOUN_BOUNDARY = "\\b(?!-)";

const HUMAN_REQUEST_PATTERNS: RegExp[] = [
  // "talk/speak/chat to|with (a/an) (real) human/person/agent/representative/rep"
  new RegExp(
    `\\b${TALK_VERB}\\s+(to|with)\\s+${ARTICLE}(real\\s+|live\\s+)?(human|person|agent|representative|rep)${NOUN_BOUNDARY}`,
  ),
  // "connect me to/with (a/an) human/person/agent/representative"
  new RegExp(`\\bconnect\\s+me\\s+(to|with)\\s+${ARTICLE}(real\\s+|live\\s+)?(human|person|agent|representative)${NOUN_BOUNDARY}`),
  // "get/put me through to (a/an) human/person/agent/representative"
  new RegExp(
    `\\b(get|put)\\s+me\\s+(through\\s+to\\s+|in\\s+touch\\s+with\\s+)?${ARTICLE}(real\\s+|live\\s+)?(human|person|agent|representative)${NOUN_BOUNDARY}`,
  ),
  // "transfer me to (a/an) human/person/agent"
  new RegExp(`\\btransfer\\s+me\\s+to\\s+${ARTICLE}(real\\s+|live\\s+)?(human|person|agent|representative)${NOUN_BOUNDARY}`),
  // "talk/speak to someone" - no target noun needed, "someone" in this
  // construction is reliably request-shaped in a support-chat context.
  new RegExp(`\\b${TALK_VERB}\\s+(to|with)\\s+someone\\b`),
  // "escalate (this) to a/an human/person/agent"
  new RegExp(`\\bescalate\\s+(this\\s+)?to\\s+${ARTICLE}(human|person|agent)${NOUN_BOUNDARY}`),
  // Standalone compound nouns that are reliable requests even without a
  // request verb - rare to appear this way outside of asking for one.
  new RegExp(`\\b(human|live)\\s+agent${NOUN_BOUNDARY}`),
  new RegExp(`\\breal\\s+(person|human)${NOUN_BOUNDARY}`),
  new RegExp(`\\bactual\\s+(human|person)${NOUN_BOUNDARY}`),
];

export function isExplicitHumanRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  return HUMAN_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized));
}
