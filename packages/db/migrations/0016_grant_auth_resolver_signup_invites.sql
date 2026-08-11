-- Custom SQL migration file, put your code below! --

-- Extends auth_resolver's existing narrow grants (see
-- 0001_grant_auth_resolver.sql, 0011/0012) to workspace_signup_invites -
-- resolving a signup invite token to "is this valid, and for whom" has
-- to happen before a request has any tenant context, same as an API key,
-- a workspace slug, or a team-invitation token.
--
-- Two grants, nothing else:
-- 1. SELECT on every column signUp() reads, including token_hash -
--    Postgres requires column-level SELECT privilege on anything
--    referenced in a WHERE clause, not just the returned columns (the
--    exact bug 0012 fixed for invitations - granted correctly here from
--    the start).
-- 2. UPDATE on used_at only - the single conditional
--    "UPDATE ... WHERE used_at IS NULL AND expires_at > now()" that
--    atomically claims an invite (claimWorkspaceSignupInvite). No other
--    column is writable via this role; email/token_hash/expires_at are
--    set once, only by the offline create-signup-invite.ts script
--    (which runs as the migrations/superuser connection, not
--    auth_resolver).
GRANT SELECT (id, email, token_hash, expires_at, used_at) ON workspace_signup_invites TO auth_resolver;
GRANT UPDATE (used_at) ON workspace_signup_invites TO auth_resolver;
