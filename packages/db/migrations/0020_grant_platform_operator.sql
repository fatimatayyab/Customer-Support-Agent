-- Custom SQL migration file, put your code below! --

-- Grants for the platform_operator role (CREATE ROLE happens in
-- infra/postgres/init/01-app-role.sql for fresh setups; an already-
-- running dev container needs the role created once by hand - see the
-- session notes). BYPASSRLS, but narrow column-level grants only:
--
-- 1. workspaces: SELECT for the workspace list/detail screens, UPDATE on
--    status/updated_at only for Suspend/Reactivate - never INSERT
--    (provisioning a new workspace reuses the existing app_user +
--    withWorkspaceContext(newWorkspaceId) path that signUp() already
--    uses, since that already solves "create a workspace with no prior
--    tenant context" without needing a bypass).
-- 2. users: SELECT only, and never password_hash - needed to show each
--    workspace's owner/team and user counts.
-- 3. workspace_signup_invites: SELECT + INSERT + the narrow UPDATE
--    already granted to auth_resolver, extended here for this role too -
--    this is what replaces the pnpm invite CLI script.
-- 4. platform_admins: SELECT + UPDATE for login verification. This is
--    the one place this role reads a password hash - unavoidable, since
--    platform_admins has no tenant context to switch into the way a
--    normal workspace login does; treat this role's connection string
--    with the same care as any credential-bearing grant.
-- 5. platform_audit_log: SELECT + INSERT - this role is the only writer
--    of its own audit trail.
GRANT SELECT (id, name, slug, status, created_at, updated_at) ON workspaces TO platform_operator;
GRANT UPDATE (status, updated_at) ON workspaces TO platform_operator;

GRANT SELECT (id, workspace_id, email, name, role, status, created_at) ON users TO platform_operator;

GRANT SELECT (id, email, token_hash, expires_at, used_at, created_at) ON workspace_signup_invites TO platform_operator;
GRANT INSERT (email, token_hash, expires_at) ON workspace_signup_invites TO platform_operator;
GRANT UPDATE (expires_at) ON workspace_signup_invites TO platform_operator;

GRANT SELECT (id, email, password_hash, name, status) ON platform_admins TO platform_operator;
GRANT UPDATE (password_hash, status, updated_at) ON platform_admins TO platform_operator;

GRANT SELECT (id, platform_admin_id, action, target_workspace_id, detail, created_at) ON platform_audit_log TO platform_operator;
GRANT INSERT (platform_admin_id, action, target_workspace_id, detail) ON platform_audit_log TO platform_operator;