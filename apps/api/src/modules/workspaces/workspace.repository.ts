import { eq } from "drizzle-orm";
import { workspaces, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

export async function insertWorkspace(scopedDb: ScopedDb, params: { id: string; name: string; slug: string }) {
  const [workspace] = await scopedDb.insert(workspaces).values(params).returning();
  return assertDefined(workspace, "insertWorkspace: INSERT ... RETURNING produced no row.");
}

export async function getWorkspaceById(scopedDb: ScopedDb, id: string) {
  const [workspace] = await scopedDb.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  return workspace ?? null;
}
