import { eq, isNull, and } from "drizzle-orm";
import { workspaceApiKeys, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

export async function insertApiKey(
  scopedDb: ScopedDb,
  params: { workspaceId: string; name: string; keyPrefix: string; keyHash: string },
) {
  const [apiKey] = await scopedDb.insert(workspaceApiKeys).values(params).returning();
  return assertDefined(apiKey, "insertApiKey: INSERT ... RETURNING produced no row.");
}

export async function listActiveApiKeys(scopedDb: ScopedDb, workspaceId: string) {
  return scopedDb
    .select({
      id: workspaceApiKeys.id,
      name: workspaceApiKeys.name,
      keyPrefix: workspaceApiKeys.keyPrefix,
      lastUsedAt: workspaceApiKeys.lastUsedAt,
      createdAt: workspaceApiKeys.createdAt,
    })
    .from(workspaceApiKeys)
    .where(and(eq(workspaceApiKeys.workspaceId, workspaceId), isNull(workspaceApiKeys.revokedAt)));
}

export async function revokeApiKey(scopedDb: ScopedDb, workspaceId: string, id: string) {
  const [revoked] = await scopedDb
    .update(workspaceApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(workspaceApiKeys.id, id), eq(workspaceApiKeys.workspaceId, workspaceId)))
    .returning({ id: workspaceApiKeys.id });
  return revoked ?? null;
}
