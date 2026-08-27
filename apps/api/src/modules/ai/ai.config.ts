// Named constants rather than inline magic values - there's no AI
// Configuration entity/table yet (04_Domain_Model.md describes one as
// future, per-workspace), so these are hardcoded, sensible defaults
// until that exists. Easy to tune here; not worth a settings UI yet.
//
// Provider-agnostic only: each provider (providers/*.ts) owns its own
// model name constant, since that's a provider-specific detail, not a
// business tuning knob shared across providers.

export const MAX_OUTPUT_TOKENS = 1024;

/**
 * Below this, a reply is escalated even though the AI did answer -
 * the model itself judged its own answer as weakly supported by the
 * provided context. Tunable; not yet workspace-configurable.
 */
export const CONFIDENCE_ESCALATION_THRESHOLD = 0.5;

/**
 * Knowledge chunks below this similarity are treated as noise, not
 * context - excluded before the AI ever sees them. Informed by Phase 2's
 * real measurements: unrelated topics scored ~0.13-0.25, related topics
 * ~0.38-0.57 (voyage-3-lite). If retrieval returns nothing above this
 * floor, the AI is never called at all (see support-orchestrator.ts) -
 * a structural guarantee against answering from general knowledge when
 * there's nothing relevant to ground on, not just a prompt instruction.
 */
export const MIN_RELEVANCE_SIMILARITY = 0.25;

/** Caps how much conversation history gets sent per generation call. */
export const MAX_HISTORY_MESSAGES = 20;

/** How many knowledge chunks to retrieve before filtering by relevance. */
export const RETRIEVAL_LIMIT = 5;

/**
 * Caps how many times the AI may execute lookup_contact within a single
 * conversation (Support Orchestrator Stage 1). The eligibility gate
 * (integration-lookup-phrases.ts) already restricts *which* messages
 * can offer the tool and *which* email it may run against, but nothing
 * else bounds how many distinct emails one conversation can probe - an
 * anonymous customer channel means the "customer" asking is unverified,
 * so this exists specifically to blunt bulk CRM-membership probing
 * within one conversation, on top of the existing per-conversation
 * widget rate limit (which bounds message frequency, not lookup count).
 */
export const MAX_AI_TRIGGERED_LOOKUPS_PER_CONVERSATION = 3;
