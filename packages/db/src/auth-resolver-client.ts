import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { Pool } from "pg";
import { dbEnv } from "./env.js";
import { invitations, workspaceApiKeys, workspaceSignupInvites, workspaces } from "./schema/index.js";

// Connects as auth_resolver (BYPASSRLS, granted SELECT on nothing but a
// few columns of workspaces, workspace_api_keys, and invitations - see
// infra/postgres/init/01-app-role.sql and the grants in this package's
// migrations). This is the one deliberate, narrow exception to "every
// query goes through withWorkspaceContext": resolving a public
// identifier (a widget API key, a workspace slug at login, or an
// invitation token) into a workspace_id has to happen before the request
// has a tenant context to scope a normal query with. Nothing else should
// use this client.
// Lower than the main app_user pool (client.ts) - this connection only
// serves the narrow pre-tenant-context lookups (API key/slug/token
// resolution), a much smaller share of total query volume.
const authResolverPool = new Pool({ connectionString: dbEnv.AUTH_RESOLVER_DATABASE_URL, max: 5 });
const authResolverDb = drizzle(authResolverPool, {
  schema: { workspaceApiKeys, workspaces, invitations, workspaceSignupInvites },
});

export async function findApiKeyByHash(keyHash: string) {
  // Column list matches the migration's grant exactly (id, workspace_id,
  // key_hash, revoked_at on workspace_api_keys; status also already
  // granted on workspaces for the login-by-slug path) - auth_resolver has
  // no SELECT privilege on any other column, so a bare select() here
  // would fail with a Postgres permission error.
  //
  // Joins workspaces.status so requireApiKey can reject a suspended
  // workspace's widget traffic, not just its dashboard logins - without
  // this, Suspend (the Platform Owner Dashboard's core action) would stop
  // a client from logging in while their embedded widget kept running
  // and incurring AI cost indefinitely.
  const [row] = await authResolverDb
    .select({
      id: workspaceApiKeys.id,
      workspaceId: workspaceApiKeys.workspaceId,
      keyHash: workspaceApiKeys.keyHash,
      revokedAt: workspaceApiKeys.revokedAt,
      allowedOrigins: workspaceApiKeys.allowedOrigins,
      workspaceStatus: workspaces.status,
    })
    .from(workspaceApiKeys)
    .innerJoin(workspaces, eq(workspaces.id, workspaceApiKeys.workspaceId))
    .where(eq(workspaceApiKeys.keyHash, keyHash))
    .limit(1);

  return row ?? null;
}

// Fire-and-forget from requireApiKey - a pre-existing gap (the column
// existed and was displayed in the dashboard, but nothing ever wrote it,
// so every key showed "never used" regardless of real traffic). Doesn't
// block the request on this write; a lost update under a race or a
// dropped connection just means a slightly stale "last used" display,
// never an auth-correctness issue.
export async function touchApiKeyLastUsed(id: string): Promise<void> {
  await authResolverDb.update(workspaceApiKeys).set({ lastUsedAt: sql`now()` }).where(eq(workspaceApiKeys.id, id));
}

export async function findWorkspaceBySlug(slug: string) {
  const [row] = await authResolverDb
    .select({ id: workspaces.id, slug: workspaces.slug, status: workspaces.status })
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);

  return row ?? null;
}

// Separate from findWorkspaceBySlug rather than widening its selected
// columns - `name` is only ever needed for the invitation-preview screen
// ("you've been invited to join <name>"), not the login path, so it gets
// its own narrow query instead of every caller of findWorkspaceBySlug
// silently starting to fetch a column it doesn't use.
export async function findWorkspaceNameById(workspaceId: string) {
  const [row] = await authResolverDb
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return row?.name ?? null;
}

// Read-only, for producing a specific "invalid / expired / already used /
// wrong email" message before attempting the real claim below - mirrors
// the invitations flow's own preview-then-accept split. This lookup is
// never the security boundary by itself (see claimWorkspaceSignupInvite).
export async function findWorkspaceSignupInviteByTokenHash(tokenHash: string) {
  const [row] = await authResolverDb
    .select({
      id: workspaceSignupInvites.id,
      email: workspaceSignupInvites.email,
      expiresAt: workspaceSignupInvites.expiresAt,
      usedAt: workspaceSignupInvites.usedAt,
    })
    .from(workspaceSignupInvites)
    .where(eq(workspaceSignupInvites.tokenHash, tokenHash))
    .limit(1);

  return row ?? null;
}

// The actual single-use guarantee: one conditional UPDATE, the same
// atomic-claim shape invitations.acceptInvitation already uses for team
// invites (a separate read-then-write here would leave a real race
// window between two concurrent signups holding the same token). Returns
// true if this call is the one that claimed it, false if it was already
// used/expired by the time this ran (including by a concurrent request
// that won the race) - the caller can't tell those apart from the return
// value alone, which is fine, since findWorkspaceSignupInviteByTokenHash
// above already produced whatever specific message the caller is going
// to show.
export async function claimWorkspaceSignupInvite(tokenHash: string): Promise<boolean> {
  const result = await authResolverDb
    .update(workspaceSignupInvites)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(workspaceSignupInvites.tokenHash, tokenHash),
        isNull(workspaceSignupInvites.usedAt),
        gt(workspaceSignupInvites.expiresAt, sql`now()`),
      ),
    );

  return (result.rowCount ?? 0) > 0;
}

export async function findInvitationByTokenHash(tokenHash: string) {
  // Selected columns match the grant (id, workspace_id, email, role,
  // status, expires_at) - token_hash is also granted (Postgres requires
  // column privilege for a WHERE reference, not just selected columns -
  // caught the hard way when this was first missing) but deliberately
  // never appears in the selected list below; invited_by_user_id isn't
  // granted at all.
  const [row] = await authResolverDb
    .select({
      id: invitations.id,
      workspaceId: invitations.workspaceId,
      email: invitations.email,
      role: invitations.role,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(eq(invitations.tokenHash, tokenHash))
    .limit(1);

  return row ?? null;
}
