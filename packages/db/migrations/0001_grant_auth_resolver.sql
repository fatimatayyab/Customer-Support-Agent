-- Custom SQL migration file, put your code below! --

-- auth_resolver (see infra/postgres/init/01-app-role.sql) is BYPASSRLS
-- and exists solely to resolve a public identifier - a widget API key,
-- or a workspace slug at login - into a workspace_id before a request
-- has a tenant context. Its grants are intentionally column-limited and
-- table-limited: nothing beyond what those two lookups require.
GRANT SELECT (id, slug, status) ON workspaces TO auth_resolver;
GRANT SELECT (id, workspace_id, key_hash, revoked_at) ON workspace_api_keys TO auth_resolver;
