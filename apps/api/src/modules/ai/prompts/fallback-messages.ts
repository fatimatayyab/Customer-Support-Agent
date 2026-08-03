// Hardcoded, not AI-generated: these fire specifically in the two cases
// where we deliberately never call (or can't trust the result of) the
// model - see support-orchestrator.ts. Keeping the wording here, next
// to the other customer-facing prompt content, rather than inline at
// the call site.

export const NO_RELEVANT_KNOWLEDGE_MESSAGE =
  "Thanks for reaching out! I couldn't find enough information in our knowledge base to answer that confidently, so I've flagged this conversation for a team member to follow up.";

export const PROVIDER_ERROR_MESSAGE =
  "Thanks for your patience - I'm having trouble generating a response right now. I've flagged this conversation for a team member to follow up.";
