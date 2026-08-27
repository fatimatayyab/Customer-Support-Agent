import { withWorkspaceContext } from "@csa/db";
import { AppError, NotFoundError } from "../../errors.js";
import { decryptCredentials, encryptCredentials } from "./credential-crypto.js";
import {
  deleteIntegration,
  getIntegrationForWorkspace,
  listIntegrations,
  updateIntegrationConfig,
  upsertIntegration,
} from "./integration.repository.js";
import type { ContactLookupResult, IntegrationProvider } from "./integration-provider.js";
import { HubSpotIntegrationProvider } from "./providers/hubspot-integration-provider.js";

/**
 * Unlike ai.service.ts's createAiProvider() (one platform-wide instance,
 * chosen by an env var), an Integration is per-workspace data: each
 * business connects its own account with its own credentials. So there's
 * no module-level singleton here - every call looks up the workspace's
 * own row, decrypts its own credentials, and instantiates a provider
 * scoped to that one workspace's connection.
 *
 * The one thing that IS swappable is which class turns those credentials
 * into a provider instance - defaulted to the real HubSpot class so
 * production never has to think about it, but a real, explicit
 * dependency injection seam (same reasoning as ai.service.ts's
 * `provider` parameter) rather than a module you'd have to mock.
 * Typed concretely as HubSpotIntegrationProvider, not the neutral
 * IntegrationProvider interface - connectHubspot is already a
 * HubSpot-specific flow (verifyConnection is deliberately NOT part of
 * the neutral interface, see that method's own comment), so there's no
 * boundary purity to preserve here the way lookupContact below has to.
 */
type HubSpotConnectProviderFactory = (credentials: { accessToken: string }) => HubSpotIntegrationProvider;
const defaultHubSpotConnectProviderFactory: HubSpotConnectProviderFactory = (credentials) =>
  new HubSpotIntegrationProvider(credentials);

export async function connectHubspot(
  workspaceId: string,
  accessToken: string,
  createProvider: HubSpotConnectProviderFactory = defaultHubSpotConnectProviderFactory,
) {
  // Verify before saving - a bad token (or one missing the read scope
  // this feature needs) fails loudly here instead of silently the first
  // time an agent tries to use it. Caught and rethrown as an AppError:
  // the underlying HTTP error is a genuinely bad credential the caller
  // just supplied, not an unexpected server failure - 400, not a generic
  // 500, and the message is safe to show (dashboard-only, admin route).
  try {
    await createProvider({ accessToken }).verifyConnection();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    throw new AppError(`Could not connect to HubSpot: ${message}`, 400);
  }

  const credentials = await encryptCredentials({ accessToken });

  return withWorkspaceContext(workspaceId, async (scopedDb) => {
    // Reconnecting (e.g. after rotating an expired token) must not
    // silently reset config back to {} - upsertIntegration's ON
    // CONFLICT does a full replace of config, and aiToolCallingEnabled
    // is the one config key that exists today. Without this, the
    // routine "paste a new token" flow would silently disable AI
    // tool-calling every time, with no error or indication anywhere.
    const existing = await getIntegrationForWorkspace(scopedDb, workspaceId, "hubspot");
    return upsertIntegration(scopedDb, {
      workspaceId,
      provider: "hubspot",
      credentials,
      config: existing?.config ?? {},
    });
  });
}

export async function listWorkspaceIntegrations(workspaceId: string) {
  return withWorkspaceContext(workspaceId, (scopedDb) => listIntegrations(scopedDb, workspaceId));
}

export async function disconnectIntegration(workspaceId: string, id: string): Promise<void> {
  const deleted = await withWorkspaceContext(workspaceId, (scopedDb) => deleteIntegration(scopedDb, workspaceId, id));
  if (!deleted) {
    throw new NotFoundError("Integration not found.");
  }
}

// Owner/Administrator-gated at the route (integration.routes.ts) - a
// workspace opts in explicitly before the AI can trigger a lookup on
// its own; a connected integration alone is never enough (see
// generateAiReply's eligibility gate in support-orchestrator.ts, which
// checks this in addition to its own message-content gate).
export async function setAiToolCallingEnabled(workspaceId: string, id: string, enabled: boolean): Promise<void> {
  const updated = await withWorkspaceContext(workspaceId, (scopedDb) =>
    updateIntegrationConfig(scopedDb, workspaceId, id, { aiToolCallingEnabled: enabled }),
  );
  if (!updated) {
    throw new NotFoundError("Integration not found.");
  }
}

// The other half of generateAiReply's eligibility gate: even a message
// that passes the deterministic content check (integration-lookup-phrases.ts)
// only reaches the model with the tool offered if the workspace has
// BOTH a connected HubSpot integration AND has explicitly opted in via
// the toggle above. Returns false, never throws, for "not connected" -
// this is a routine eligibility check on the hot path of every AI
// reply, not a user-triggered action reporting its own failure.
export async function isAiToolCallingEnabled(workspaceId: string): Promise<boolean> {
  const integration = await withWorkspaceContext(workspaceId, (scopedDb) =>
    getIntegrationForWorkspace(scopedDb, workspaceId, "hubspot"),
  );
  if (!integration || integration.status !== "connected") {
    return false;
  }
  const config = integration.config as { aiToolCallingEnabled?: boolean } | null;
  return config?.aiToolCallingEnabled === true;
}

// `result: null` (with `errorMessage` set) vs. throwing NotFoundError are
// deliberately different failure modes for the caller (support-orchestrator.ts)
// to distinguish: "not connected" is a precondition - there's no
// integration row yet, so there's nothing to attribute an audit log
// entry to. A provider-call failure (bad token, HubSpot down, rate
// limited) happens *after* a real integration was found, so the caller
// always has an integrationId to log the failure against.
export interface ContactLookupOutcome {
  integrationId: string;
  result: ContactLookupResult | null;
  errorMessage?: string;
}

// Neutral IntegrationProvider factory, not the concrete-typed one
// connectHubspot above uses - lookupContact only ever calls the
// interface's own lookupContact() method, so it can (and should) stay
// as vendor-agnostic as the Orchestrator that calls it.
type IntegrationProviderFactory = (credentials: { accessToken: string }) => IntegrationProvider;
const defaultIntegrationProviderFactory: IntegrationProviderFactory = (credentials) =>
  new HubSpotIntegrationProvider(credentials);

export async function lookupContact(
  workspaceId: string,
  email: string,
  createProvider: IntegrationProviderFactory = defaultIntegrationProviderFactory,
): Promise<ContactLookupOutcome> {
  const integration = await withWorkspaceContext(workspaceId, (scopedDb) =>
    getIntegrationForWorkspace(scopedDb, workspaceId, "hubspot"),
  );
  if (!integration) {
    throw new NotFoundError("No CRM integration is connected for this workspace.");
  }

  // Decryption is inside the same try/catch as the provider call, not
  // just the HTTP request: a corrupt or unreadable credential (e.g. after
  // an INTEGRATION_CREDENTIALS_KEY rotation with no migration) is still
  // an "attempt against a known integration that failed" - it should
  // still produce an audit log entry, not bypass one by throwing before
  // the caller can log it.
  try {
    const credentials = await decryptCredentials<{ accessToken: string }>(integration.credentials);
    const provider = createProvider(credentials);
    const result = await provider.lookupContact({ email });
    return { integrationId: integration.id, result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown integration error.";
    return { integrationId: integration.id, result: null, errorMessage };
  }
}
