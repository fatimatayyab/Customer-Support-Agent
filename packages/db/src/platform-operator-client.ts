import { drizzle } from "drizzle-orm/node-postgres";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Pool } from "pg";
import { dbEnv } from "./env.js";
import {
  conversations,
  integrations,
  knowledgeSources,
  platformAdmins,
  platformAuditLog,
  users,
  workspaceApiKeys,
  workspacePlatformMeta,
  workspaces,
  workspaceSignupInvites,
} from "./schema/index.js";

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
// Low - only the Platform Owner Dashboard's own traffic reaches this
// pool, a small fraction of the main app_user pool's volume.
const platformOperatorPool = new Pool({ connectionString: dbEnv.PLATFORM_OPERATOR_DATABASE_URL, max: 5 });
const platformOperatorDb = drizzle(platformOperatorPool, {
  schema: {
    conversations,
    integrations,
    knowledgeSources,
    platformAdmins,
    platformAuditLog,
    users,
    workspaceApiKeys,
    workspacePlatformMeta,
    workspaces,
    workspaceSignupInvites,
  },
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
      plan: sql<string | null>`(
        select "workspace_platform_meta"."plan" from "workspace_platform_meta"
        where "workspace_platform_meta"."workspace_id" = "workspaces"."id"
      )`,
      // "Has at least one non-revoked key" rather than a count - the list
      // view only needs "is this client actually embedded anywhere,"
      // the detail page's key list covers the rest.
      widgetConfigured: sql<boolean>`exists(
        select 1 from "workspace_api_keys"
        where "workspace_api_keys"."workspace_id" = "workspaces"."id" and "workspace_api_keys"."revoked_at" is null
      )`,
      // Deliberately from `conversations`, not `messages` - conversation
      // start time is an adequate "still active" proxy for a V1 health
      // view without granting platform_operator anything on the
      // customer-conversation-content table at all (see the messages-
      // access design discussion: the marginal value of a true last-
      // message timestamp didn't justify that privilege surface).
      lastActivityAt: sql<string | null>`(
        select max("conversations"."created_at") from "conversations"
        where "conversations"."workspace_id" = "workspaces"."id"
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

// Conversation status breakdown + total, all from `conversations`
// (workspace_id, status, created_at only - never `metadata`, and
// deliberately no grant on `messages` at all, see listWorkspacesForPlatform's
// lastActivityAt comment). Status counts are a better operational health
// signal than raw message volume anyway - "12 unassigned escalations"
// says something actionable; "200 messages" doesn't.
export async function getWorkspaceUsageForPlatform(workspaceId: string) {
  const statusBreakdown = await platformOperatorDb
    .select({ status: conversations.status, count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(eq(conversations.workspaceId, workspaceId))
    .groupBy(conversations.status);

  const totalConversations = statusBreakdown.reduce((sum, row) => sum + row.count, 0);

  const [knowledgeSourceCount, integrationList] = await Promise.all([
    countKnowledgeSourcesForPlatform(workspaceId),
    listIntegrationsForPlatform(workspaceId),
  ]);

  return { totalConversations, statusBreakdown, knowledgeSourceCount, integrations: integrationList };
}

// Count only, never title/content - a knowledge base's own text is the
// workspace's business content, not something the platform surface needs
// to read to answer "has this client finished setup."
export async function countKnowledgeSourcesForPlatform(workspaceId: string): Promise<number> {
  const [row] = await platformOperatorDb
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeSources)
    .where(eq(knowledgeSources.workspaceId, workspaceId));
  return row?.count ?? 0;
}

// provider + status only - never credentials/config, which is where any
// vendor-specific secret or non-secret config would live.
export async function listIntegrationsForPlatform(workspaceId: string) {
  return platformOperatorDb
    .select({ provider: integrations.provider, status: integrations.status })
    .from(integrations)
    .where(eq(integrations.workspaceId, workspaceId));
}

// Never selects keyHash - same discipline as the dashboard's own
// listActiveApiKeys (api-key.repository.ts). Includes revoked keys too
// (unlike the workspace-owner-facing list) since the platform view's job
// is a full picture, not just "what's currently active."
export async function listApiKeysForPlatform(workspaceId: string) {
  return platformOperatorDb
    .select({
      id: workspaceApiKeys.id,
      name: workspaceApiKeys.name,
      keyPrefix: workspaceApiKeys.keyPrefix,
      lastUsedAt: workspaceApiKeys.lastUsedAt,
      revokedAt: workspaceApiKeys.revokedAt,
      createdAt: workspaceApiKeys.createdAt,
    })
    .from(workspaceApiKeys)
    .where(eq(workspaceApiKeys.workspaceId, workspaceId))
    .orderBy(desc(workspaceApiKeys.createdAt));
}

// Conditional on revokedAt IS NULL, same "0 rows = nothing to do, not an
// error" shape used throughout this file - revoking an already-revoked
// key is a clean no-op from the platform's side too.
export async function revokeApiKeyForPlatform(workspaceId: string, keyId: string): Promise<boolean> {
  const result = await platformOperatorDb
    .update(workspaceApiKeys)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(workspaceApiKeys.id, keyId), eq(workspaceApiKeys.workspaceId, workspaceId), isNull(workspaceApiKeys.revokedAt)));
  return (result.rowCount ?? 0) > 0;
}

// --- Platform-owner-only commercial metadata (plan / billing notes) ---

export async function getWorkspacePlatformMetaForPlatform(workspaceId: string) {
  const [row] = await platformOperatorDb
    .select({
      plan: workspacePlatformMeta.plan,
      billingNotes: workspacePlatformMeta.billingNotes,
      updatedAt: workspacePlatformMeta.updatedAt,
    })
    .from(workspacePlatformMeta)
    .where(eq(workspacePlatformMeta.workspaceId, workspaceId))
    .limit(1);
  return row ?? { plan: null, billingNotes: null, updatedAt: null };
}

// Upsert, not a plain update - most workspaces won't have a
// workspace_platform_meta row at all until the first time a platform
// admin sets something, since nothing creates one at provisioning time
// (there's nothing to say yet at that point). Both fields are required
// (not optional) deliberately - the dashboard's edit form always submits
// its full current state, not a partial patch, so there's no ambiguity
// here between "leave this field alone" and "clear it."
export async function upsertWorkspacePlatformMetaForPlatform(
  workspaceId: string,
  params: { plan: string | null; billingNotes: string | null },
) {
  const [row] = await platformOperatorDb
    .insert(workspacePlatformMeta)
    .values({ workspaceId, plan: params.plan, billingNotes: params.billingNotes })
    .onConflictDoUpdate({
      target: workspacePlatformMeta.workspaceId,
      set: { plan: params.plan, billingNotes: params.billingNotes, updatedAt: new Date() },
    })
    .returning({
      plan: workspacePlatformMeta.plan,
      billingNotes: workspacePlatformMeta.billingNotes,
      updatedAt: workspacePlatformMeta.updatedAt,
    });
  return assertRow(row, "upsertWorkspacePlatformMetaForPlatform: INSERT ... RETURNING produced no row.");
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
