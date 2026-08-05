-- Custom SQL migration file, put your code below! --

-- Extends auth_resolver's existing narrow grants (see
-- 0001_grant_auth_resolver.sql) for the invitation accept flow: like a
-- widget API key or a workspace slug, an invitation token has to resolve
-- to a workspace_id before a request has any tenant context to scope a
-- normal query with.
--
-- Two additive grants, nothing else:
-- 1. SELECT on the specific invitations columns the accept-preview and
--    accept-write flows need - never token_hash beyond the WHERE match,
--    never invited_by_user_id.
-- 2. workspaces.name, on top of the (id, slug, status) already granted -
--    the accept-preview screen shows "You've been invited to join
--    <name>", which the original slug-login grant never needed.
GRANT SELECT (id, workspace_id, email, role, status, expires_at) ON invitations TO auth_resolver;
GRANT SELECT (name) ON workspaces TO auth_resolver;