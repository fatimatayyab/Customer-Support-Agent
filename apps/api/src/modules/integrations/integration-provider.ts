/**
 * Abstraction over an external business system, mirroring AiProvider and
 * EmbeddingProvider. Per 03_System_Architecture.md's Integration Service:
 * this layer executes business actions, normalizes different vendors'
 * responses, and handles authentication - it never touches the database
 * and is never called by anything other than the Support Orchestrator.
 *
 * Named for what the caller needs (lookupContact), not for which vendor
 * provides it (not getHubSpotContact) - the same discipline AiProvider's
 * generateReply()/summarize() already follow. HubSpotIntegrationProvider
 * is the only implementation today; a second CRM provider (Salesforce,
 * Zoho, Dynamics) implements this same interface without the Orchestrator
 * or any route changing.
 */

export interface LookupContactInput {
  email: string;
}

/**
 * A deliberately neutral field set, not a passthrough of whatever the
 * vendor's API returns - translated by each provider implementation, the
 * same way AiReplyResult doesn't mirror a raw Gemini/Claude response.
 * sourceProvider/sourceRecordId are set by the provider itself (never
 * assumed by the caller), same reasoning as AiReplyResult.provider.
 */
export interface ContactLookupResult {
  found: boolean;
  name: string | null;
  email: string;
  phone: string | null;
  company: string | null;
  lifecycleStage: string | null;
  sourceProvider: string;
  sourceRecordId: string | null;
}

export interface IntegrationProvider {
  lookupContact(input: LookupContactInput): Promise<ContactLookupResult>;
}
