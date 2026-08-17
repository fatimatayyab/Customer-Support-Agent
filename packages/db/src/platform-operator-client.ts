import { drizzle } from "drizzle-orm/node-postgres";
import { desc, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { dbEnv } from "./env.js";
import { platformAdmins, platformAuditLog, users, workspaces, workspaceSignupInvites } from "./schema/index.js";

// Connects as platform_operator (BYPASSRLS, granted narrow column-level
// access on workspaces/users/workspace_signup_invites/platform_admins/
// platform_audit_log - see the grant migration and
// infra/postgres/init/01-app-role.sql). This is a deliberate SECOND
// bypass role, not an extension of auth_resolver: auth_resolver exists
// for one-shot, pre-tenant-context lookups (an API key, a slug, a token,
// resolved before a request has any workspace to scope a query with).
// The Platform Owner Dashboard is a different shape of problem - an
// already-authenticated platform admin running ongoing, repeated,
// cross-tenant reads/writes from a permanent HTTP surface. Keeping the
// two roles separate keeps each one's audit story (who can reach it, and
// why) clean instead of stretching auth_resolver's documented purpose.
// Nothing outside this file and the platform-admin bootstrap script
// should use this connection.
const platformOperatorPool = new Pool({ connectionString: dbEnv.PLATFORM_OPERATOR_DATABASE_URL });
const platformOperatorDb = drizzle(platformOperatorPool, {
  schema: { platformAdmins, platformAuditLog, users, workspaces, workspaceSignupInvites },
});

function assertRow<T>(row: T | undefined, message: string): T {
  if (row === undefined) {
    throw new Error(message);
  }
  return row;
}

// --- Platform admin identity (login) ---

export async function findPlatformAdminByEmail(email: string) {
  const [row] = await platformOperatorDb
    .select({
      id: platformAdmins.id,
      email: platformAdmins.email,
      passwordHash: platformAdmins.passwordHash,
      name: platformAdmins.name,
      status: platformAdmins.status,
    })
    .from(platformAdmins)
    .where(eq(platformAdmins.email, email))
    .limit(1);
  return row ?? null;
}

// --- Cross-tenant workspace reads/writes ---

// One row per workspace, with its owner's email and total user count
// resolved via correlated subqueries rather than a join+group-by - a
// workspace could in principle have more than one 'owner'-role user
// (ownership can be granted to more than one person), so this
// deliberately picks the earliest one for display rather than fanning
// out one row per owner.
export async function listWorkspacesForPlatform() {
  return platformOperatorDb
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      status: workspaces.status,
      createdAt: workspaces.createdAt,
      // Deliberately written with literal, table-qualified SQL text
      // rather than interpolating drizzle column objects
      // (${workspaces.id}, ${users.id}) - inside a raw sql`` fragment
      // those render as bare, unqualified column names, not
      // "table"."column". Since both `workspaces` and `users` have an
      // `id` column, an unqualified "id" inside this correlated
      // subquery resolved to the subquery's own users.id instead of the
      // outer workspaces.id - silently turning the correlation into
      // "users.workspace_id = users.id" (always false) instead of a
      // real join condition. Caught by comparing this query's real
      // output against the identical SQL run directly in psql, not by
      // an error - Postgres never complained, it just always returned
      // null/0. No injection risk in hardcoding these: every identifier
      // here is a fixed, known table/column name, not external input.
      ownerEmail: sql<string | null>`(
        select "users"."email" from "users"
        where "users"."workspace_id" = "workspaces"."id" and "users"."role" = 'owner'
        order by "users"."created_at" asc limit 1
      )`,
      userCount: sql<number>`(
        select count(*)::int from "users" where "users"."workspace_id" = "workspaces"."id"
      )`,
    })
    .from(workspaces)
    .orderBy(desc(workspaces.createdAt));
}

export async function getWorkspaceForPlatform(id: string) {
  const [row] = await platformOperatorDb
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      status: workspaces.status,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return row ?? null;
}

// Never selects passwordHash - same discipline as
// modules/users/user.repository.ts's listUsersForWorkspace.
export async function listUsersForPlatform(workspaceId: string) {
  return platformOperatorDb
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

export async function updateWorkspaceStatusForPlatform(id: string, status: "active" | "suspended") {
  const [row] = await platformOperatorDb
    .update(workspaces)
    .set({ status, updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning({ id: workspaces.id, status: workspaces.status });
  return row ?? null;
}

// --- Workspace signup invites (replaces the pnpm invite CLI script) ---

export async function insertWorkspaceSignupInviteForPlatform(params: {
  email: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  const [row] = await platformOperatorDb
    .insert(workspaceSignupInvites)
    .values(params)
    .returning({
      id: workspaceSignupInvites.id,
      email: workspaceSignupInvites.email,
      expiresAt: workspaceSignupInvites.expiresAt,
      createdAt: workspaceSignupInvites.createdAt,
    });
  return assertRow(row, "insertWorkspaceSignupInviteForPlatform: INSERT ... RETURNING produced no row.");
}

export async function listWorkspaceSignupInvitesForPlatform() {
  return platformOperatorDb
    .select({
      id: workspaceSignupInvites.id,
      email: workspaceSignupInvites.email,
      expiresAt: workspaceSignupInvites.expiresAt,
      usedAt: workspaceSignupInvites.usedAt,
      createdAt: workspaceSignupInvites.createdAt,
    })
    .from(workspaceSignupInvites)
    .orderBy(desc(workspaceSignupInvites.createdAt));
}

// Conditional on usedAt IS NULL, same "0 rows = nothing to revoke, not an
// error" shape as invitations.repository.ts's revokeInvitation - revoking
// an already-used or already-expired invite is a clean no-op.
export async function revokeWorkspaceSignupInviteForPlatform(id: string): Promise<boolean> {
  const result = await platformOperatorDb
    .update(workspaceSignupInvites)
    .set({ expiresAt: sql`now()` })
    .where(sql`${workspaceSignupInvites.id} = ${id} and ${workspaceSignupInvites.usedAt} is null`);
  return (result.rowCount ?? 0) > 0;
}

// --- Audit trail ---

export async function insertPlatformAuditLog(params: {
  platformAdminId: string;
  action: string;
  targetWorkspaceId?: string | null;
  detail?: unknown;
}): Promise<void> {
  await platformOperatorDb.insert(platformAuditLog).values({
    platformAdminId: params.platformAdminId,
    action: params.action,
    targetWorkspaceId: params.targetWorkspaceId ?? null,
    detail: params.detail ?? null,
  });
}

export async function listPlatformAuditLogForWorkspace(workspaceId: string) {
  return platformOperatorDb
    .select({
      id: platformAuditLog.id,
      action: platformAuditLog.action,
      detail: platformAuditLog.detail,
      createdAt: platformAuditLog.createdAt,
      platformAdminEmail: platformAdmins.email,
    })
    .from(platformAuditLog)
    .innerJoin(platformAdmins, eq(platformAuditLog.platformAdminId, platformAdmins.id))
    .where(eq(platformAuditLog.targetWorkspaceId, workspaceId))
    .orderBy(desc(platformAuditLog.createdAt));
}
