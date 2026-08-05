import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { dbEnv } from "./env.js";
import { invitations, workspaceApiKeys, workspaces } from "./schema/index.js";

// Connects as auth_resolver (BYPASSRLS, granted SELECT on nothing but a
// few columns of workspaces, workspace_api_keys, and invitations - see
// infra/postgres/init/01-app-role.sql and the grants in this package's
// migrations). This is the one deliberate, narrow exception to "every
// query goes through withWorkspaceContext": resolving a public
// identifier (a widget API key, a workspace slug at login, or an
// invitation token) into a workspace_id has to happen before the request
// has a tenant context to scope a normal query with. Nothing else should
// use this client.
const authResolverPool = new Pool({ connectionString: dbEnv.AUTH_RESOLVER_DATABASE_URL });
const authResolverDb = drizzle(authResolverPool, { schema: { workspaceApiKeys, workspaces, invitations } });

export async function findApiKeyByHash(keyHash: string) {
  // Column list matches the migration's grant exactly (id, workspace_id,
  // key_hash, revoked_at) - auth_resolver has no SELECT privilege on the
  // rest of the table (name, key_prefix, last_used_at, created_at), so a
  // bare select() here would fail with a Postgres permission error.
  const [row] = await authResolverDb
    .select({
      id: workspaceApiKeys.id,
      workspaceId: workspaceApiKeys.workspaceId,
      keyHash: workspaceApiKeys.keyHash,
      revokedAt: workspaceApiKeys.revokedAt,
    })
    .from(workspaceApiKeys)
    .where(eq(workspaceApiKeys.keyHash, keyHash))
    .limit(1);

  return row ?? null;
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
