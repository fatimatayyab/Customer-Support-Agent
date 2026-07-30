import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { dbEnv } from "./env.js";
import { workspaceApiKeys, workspaces } from "./schema/index.js";

// Connects as auth_resolver (BYPASSRLS, granted SELECT on nothing but a
// few columns of workspaces and workspace_api_keys - see
// infra/postgres/init/01-app-role.sql and the grant in this package's
// migrations). This is the one deliberate, narrow exception to "every
// query goes through withWorkspaceContext": resolving a public
// identifier (a widget API key, or a workspace slug at login) into a
// workspace_id has to happen before the request has a tenant context to
// scope a normal query with. Nothing else should use this client.
const authResolverPool = new Pool({ connectionString: dbEnv.AUTH_RESOLVER_DATABASE_URL });
const authResolverDb = drizzle(authResolverPool, { schema: { workspaceApiKeys, workspaces } });

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
