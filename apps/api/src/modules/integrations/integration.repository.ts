import { and, eq } from "drizzle-orm";
import { integrations, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

export type IntegrationProviderName = (typeof integrations.$inferSelect)["provider"];
export type IntegrationStatus = (typeof integrations.$inferSelect)["status"];

type NewIntegration = Pick<typeof integrations.$inferInsert, "workspaceId" | "provider" | "credentials" | "config">;

// Upsert on the (workspace_id, provider) unique index - reconnecting
// (e.g. pasting a new token after the old one was rotated) replaces the
// existing row rather than erroring on the unique constraint.
export async function upsertIntegration(scopedDb: ScopedDb, params: NewIntegration) {
  const [integration] = await scopedDb
    .insert(integrations)
    .values({ ...params, status: "connected", lastVerifiedAt: new Date() })
    .onConflictDoUpdate({
      target: [integrations.workspaceId, integrations.provider],
      set: {
        credentials: params.credentials,
        config: params.config,
        status: "connected",
        lastVerifiedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  return assertDefined(integration, "upsertIntegration: INSERT ... RETURNING produced no row.");
}

export async function getIntegrationForWorkspace(
  scopedDb: ScopedDb,
  workspaceId: string,
  provider: IntegrationProviderName,
) {
  const [integration] = await scopedDb
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, provider)))
    .limit(1);
  return integration ?? null;
}

// Never selects `credentials` - this is what the dashboard's integration
// list actually renders, so there's no code path where a decrypted or
// even encrypted credential value could leak into a route response.
export async function listIntegrations(scopedDb: ScopedDb, workspaceId: string) {
  return scopedDb
    .select({
      id: integrations.id,
      provider: integrations.provider,
      status: integrations.status,
      lastVerifiedAt: integrations.lastVerifiedAt,
      createdAt: integrations.createdAt,
    })
    .from(integrations)
    .where(eq(integrations.workspaceId, workspaceId));
}

export async function deleteIntegration(scopedDb: ScopedDb, workspaceId: string, id: string): Promise<boolean> {
  const deleted = await scopedDb
    .delete(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.workspaceId, workspaceId)))
    .returning({ id: integrations.id });
  return deleted.length > 0;
}
