import { eq, and } from "drizzle-orm";
import { users, type ScopedDb } from "@csa/db";
import type { WorkspaceRole } from "@csa/shared";
import { assertDefined } from "../../assert.js";

export async function insertUser(
  scopedDb: ScopedDb,
  params: { workspaceId: string; email: string; passwordHash: string; name: string; role: WorkspaceRole },
) {
  const [user] = await scopedDb.insert(users).values(params).returning();
  return assertDefined(user, "insertUser: INSERT ... RETURNING produced no row.");
}

export async function getUserByEmail(scopedDb: ScopedDb, workspaceId: string, email: string) {
  const [user] = await scopedDb
    .select()
    .from(users)
    .where(and(eq(users.workspaceId, workspaceId), eq(users.email, email)))
    .limit(1);
  return user ?? null;
}

export async function getUserById(scopedDb: ScopedDb, workspaceId: string, id: string) {
  const [user] = await scopedDb
    .select()
    .from(users)
    .where(and(eq(users.workspaceId, workspaceId), eq(users.id, id)))
    .limit(1);
  return user ?? null;
}

// Never selects passwordHash - this is what the dashboard's team page
// renders, so there's no code path where a hash could leak into a route
// response.
export async function listUsersForWorkspace(scopedDb: ScopedDb, workspaceId: string) {
  return scopedDb
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.workspaceId, workspaceId))
    .orderBy(users.createdAt);
}
