/**
 * Deliberately conservative, deterministic eligibility gate for letting a
 * message reach the model with the lookup_contact tool available -
 * mirrors human-request-phrases.ts's own precision-over-recall approach
 * and exists for the same structural reason: a connected integration
 * alone must NOT be enough to bypass the no-relevant-knowledge fast path
 * (support-orchestrator.ts) for an unrelated question. Merely having
 * HubSpot connected shouldn't change how "what's your return policy" (a
 * knowledge-empty, non-account question) is handled - only a message
 * that's plausibly asking about the customer's OWN account/contact
 * record, with a real email address already in context for the tool to
 * use, is eligible. Everything else keeps today's exact behavior: the
 * deterministic no_relevant_knowledge escalation, no model call, no
 * tool exposure.
 *
 * A missed eligible question degrades gracefully (falls through to the
 * existing fast-path escalation, same as today) - a false positive does
 * not, since it would spend a model call and expose the tool for a
 * question lookupContact can never actually answer. Both conditions
 * below must hold; neither is sufficient alone.
 */

const ARTICLE = "((a|an|the)\\s+)?";
const POSSESSIVE = "(my|our)";

const ACCOUNT_LOOKUP_PATTERNS: RegExp[] = [
  // "am I/are we a customer", "am I already a customer"
  new RegExp(`\\b(am\\s+i|are\\s+we)\\s+(already\\s+)?${ARTICLE}(existing\\s+|current\\s+)?customer\\b`),
  // "my/our account status", "what's my account status", "is my account active"
  new RegExp(`\\b${POSSESSIVE}\\s+account\\s+(status|active)\\b`),
  new RegExp(`\\b(what'?s|what\\s+is|check)\\s+${POSSESSIVE}\\s+account\\s+status\\b`),
  new RegExp(`\\bis\\s+${POSSESSIVE}\\s+account\\s+active\\b`),
  // "do you have my info/information/details/record", "my info on file"
  new RegExp(`\\bdo\\s+you\\s+have\\s+${POSSESSIVE}\\s+(info|information|details|record)\\b`),
  new RegExp(`\\b${POSSESSIVE}\\s+(info|information|details)\\s+on\\s+file\\b`),
  // "who's my rep/account manager/point of contact/contact person"
  new RegExp(`\\bwho(('?s)|\\s+is)\\s+${POSSESSIVE}\\s+(rep|account\\s+manager|point\\s+of\\s+contact|contact\\s+person)\\b`),
  // "what company am I with/associated with"
  new RegExp(`\\bwhat\\s+company\\s+am\\s+i\\s+(with|associated\\s+with)\\b`),
];

// Deliberately simple - identifying "an email-shaped string exists
// somewhere nearby," not validating one. Only decides whether to offer
// the tool at all; it is NOT what authorizes which email the tool
// actually runs against - see extractEmails/support-orchestrator.ts's
// own validation of outcome.args.email against this same customer-text
// set before the tool is ever executed.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const EMAIL_PATTERN_GLOBAL = new RegExp(EMAIL_PATTERN.source, "gi");

export function isAccountLookupQuestion(message: string): boolean {
  const normalized = message.toLowerCase();
  return ACCOUNT_LOOKUP_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hasIdentifiableEmail(texts: string[]): boolean {
  return texts.some((text) => EMAIL_PATTERN.test(text));
}

// The authorization-relevant half of the gate: the model is only ever
// allowed to look up an email that actually appears in the customer's
// own words, never one it read out of retrieved knowledge content or
// invented on its own (the system prompt already asks for this - this
// enforces it server-side instead of trusting the model to comply).
// Deliberately restricted to caller-supplied customer-authored text -
// callers must not pass AI/system messages in here.
export function extractEmails(texts: string[]): string[] {
  return texts.flatMap((text) => text.match(EMAIL_PATTERN_GLOBAL) ?? []);
}
