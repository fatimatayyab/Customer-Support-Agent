import { env } from "../../config/env.js";
import { AirtableEscalationProvider } from "./providers/airtable-provider.js";
import type { EscalationContactSyncInput, EscalationContactSyncResult, EscalationSyncProvider } from "./escalation-sync-provider.js";

// Configuration-driven per AIRTABLE_* (env.ts), mirroring ai.service.ts's
// createAiProvider()/getDefaultAiProvider() shape - one platform-wide
// instance, not integration.service.ts's per-workspace-row pattern
// (there is no workspace to look up: this destination is the same for
// every workspace). Returns null, not a thrown error, when unconfigured -
// syncEscalationContact treats that as "nothing to do," the same way a
// workspace simply not having connected HubSpot is a legitimate no-op
// for lookupContact's sibling concept, not a failure.
function createEscalationSyncProvider(): EscalationSyncProvider | null {
  if (!env.AIRTABLE_API_KEY || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME) {
    return null;
  }
  return new AirtableEscalationProvider({
    apiKey: env.AIRTABLE_API_KEY,
    baseId: env.AIRTABLE_BASE_ID,
    tableName: env.AIRTABLE_TABLE_NAME,
  });
}

let defaultEscalationSyncProvider: EscalationSyncProvider | null | undefined;
function getDefaultEscalationSyncProvider(): EscalationSyncProvider | null {
  return (defaultEscalationSyncProvider ??= createEscalationSyncProvider());
}

export interface EscalationSyncOutcome {
  result: EscalationContactSyncResult | null;
  errorMessage?: string;
}

// Returns null (not a thrown error, not an outcome object) when the
// platform's own Airtable config isn't set - the caller
// (support-orchestrator.ts) treats that as a silent no-op, same as
// before this was moved out of integration.service.ts. No workspaceId
// parameter: unlike the old per-workspace lookup, there is nothing to
// look up - it's configured for the whole platform or it isn't.
export async function syncEscalationContact(
  input: EscalationContactSyncInput,
  provider: EscalationSyncProvider | null = getDefaultEscalationSyncProvider(),
): Promise<EscalationSyncOutcome | null> {
  if (!provider) {
    return null;
  }

  try {
    const result = await provider.syncEscalationContact(input);
    return { result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown escalation sync error.";
    return { result: null, errorMessage };
  }
}
