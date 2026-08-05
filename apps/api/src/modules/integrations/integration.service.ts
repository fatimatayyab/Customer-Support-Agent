import { withWorkspaceContext } from "@csa/db";
import { AppError, NotFoundError } from "../../errors.js";
import { decryptCredentials, encryptCredentials } from "./credential-crypto.js";
import { deleteIntegration, getIntegrationForWorkspace, listIntegrations, upsertIntegration } from "./integration.repository.js";
import type { ContactLookupResult } from "./integration-provider.js";
import { HubSpotIntegrationProvider } from "./providers/hubspot-integration-provider.js";

/**
 * Unlike ai.service.ts's createAiProvider() (one platform-wide instance,
 * chosen by an env var), an Integration is per-workspace data: each
 * business connects its own account with its own credentials. So there's
 * no module-level singleton here - every call looks up the workspace's
 * own row, decrypts its own credentials, and instantiates a provider
 * scoped to that one workspace's connection.
 */

export async function connectHubspot(workspaceId: string, accessToken: string) {
  // Verify before saving - a bad token (or one missing the read scope
  // this feature needs) fails loudly here instead of silently the first
  // time an agent tries to use it. Caught and rethrown as an AppError:
  // the underlying HTTP error is a genuinely bad credential the caller
  // just supplied, not an unexpected server failure - 400, not a generic
  // 500, and the message is safe to show (dashboard-only, admin route).
  try {
    await new HubSpotIntegrationProvider({ accessToken }).verifyConnection();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    throw new AppError(`Could not connect to HubSpot: ${message}`, 400);
  }

  const credentials = await encryptCredentials({ accessToken });

  return withWorkspaceContext(workspaceId, (scopedDb) =>
    upsertIntegration(scopedDb, { workspaceId, provider: "hubspot", credentials, config: {} }),
  );
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

export async function lookupContact(workspaceId: string, email: string): Promise<ContactLookupOutcome> {
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
    const provider = new HubSpotIntegrationProvider(credentials);
    const result = await provider.lookupContact({ email });
    return { integrationId: integration.id, result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown integration error.";
    return { integrationId: integration.id, result: null, errorMessage };
  }
}
