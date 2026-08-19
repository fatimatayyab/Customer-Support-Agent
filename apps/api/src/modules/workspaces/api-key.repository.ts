import { eq, isNull, and } from "drizzle-orm";
import { workspaceApiKeys, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

export async function insertApiKey(
  scopedDb: ScopedDb,
  params: {
    workspaceId: string;
    name: string;
    keyPrefix: string;
    keyHash: string;
    allowedOrigins: string[] | null;
  },
) {
  const [apiKey] = await scopedDb.insert(workspaceApiKeys).values(params).returning();
  return assertDefined(apiKey, "insertApiKey: INSERT ... RETURNING produced no row.");
}

// Includes allowedOrigins/revokedAt (never selected into the workspace-
// owner-facing list response) - this is an internal lookup for the
// rotate flow, which needs to read a key's current settings before
// revoking it, not a route response shape.
export async function getApiKeyById(scopedDb: ScopedDb, workspaceId: string, id: string) {
  const [apiKey] = await scopedDb
    .select()
    .from(workspaceApiKeys)
    .where(and(eq(workspaceApiKeys.id, id), eq(workspaceApiKeys.workspaceId, workspaceId)))
    .limit(1);
  return apiKey ?? null;
}

export async function listActiveApiKeys(scopedDb: ScopedDb, workspaceId: string) {
  return scopedDb
    .select({
      id: workspaceApiKeys.id,
      name: workspaceApiKeys.name,
      keyPrefix: workspaceApiKeys.keyPrefix,
      allowedOrigins: workspaceApiKeys.allowedOrigins,
      lastUsedAt: workspaceApiKeys.lastUsedAt,
      createdAt: workspaceApiKeys.createdAt,
    })
    .from(workspaceApiKeys)
    .where(and(eq(workspaceApiKeys.workspaceId, workspaceId), isNull(workspaceApiKeys.revokedAt)));
}

// Deliberately ignores revokedAt, unlike listActiveApiKeys - this answers
// "has this workspace ever had a key row at all," not "does it have one
// now." The dashboard's auto-provision-on-first-visit flow (widget.routes
// GET /workspaces/api-keys) needs this distinction: an empty active list
// means "never installed" only the first time ever; after that it means
// "explicitly removed," and auto-provisioning a replacement in that case
// would silently undo the removal on the owner's next page load.
export async function hasAnyApiKeyEverExisted(scopedDb: ScopedDb, workspaceId: string): Promise<boolean> {
  const [row] = await scopedDb
    .select({ id: workspaceApiKeys.id })
    .from(workspaceApiKeys)
    .where(eq(workspaceApiKeys.workspaceId, workspaceId))
    .limit(1);
  return row !== undefined;
}

export async function revokeApiKey(scopedDb: ScopedDb, workspaceId: string, id: string) {
  const [revoked] = await scopedDb
    .update(workspaceApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(workspaceApiKeys.id, id), eq(workspaceApiKeys.workspaceId, workspaceId)))
    .returning({ id: workspaceApiKeys.id });
  return revoked ?? null;
}
