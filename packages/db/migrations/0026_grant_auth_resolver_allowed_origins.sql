-- Custom SQL migration file, put your code below! --

-- Extends auth_resolver's existing narrow grant on workspace_api_keys
-- (0001_grant_auth_resolver.sql: id, workspace_id, key_hash, revoked_at)
-- with read access to the new allowed_origins column - requireApiKey
-- needs to read it to enforce the domain allowlist, the same role that
-- already resolves the key itself pre-tenant-context.
GRANT SELECT (allowed_origins) ON workspace_api_keys TO auth_resolver;
