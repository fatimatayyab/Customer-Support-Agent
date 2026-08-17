-- Custom SQL migration file, put your code below! --

-- Fixes a gap in 0020's INSERT grants, caught by actually running the
-- provisioning flow rather than just reading the grants back: Postgres
-- requires INSERT privilege on every column that appears in the
-- generated column list, including ones filled with DEFAULT - and
-- Drizzle's insert() always lists every table column explicitly rather
-- than only the ones passed to .values(). 0020 only granted INSERT on
-- the columns application code actually sets (email/token_hash/
-- expires_at, and platform_admin_id/action/target_workspace_id/detail);
-- id/used_at/created_at still need INSERT privilege too even though
-- their values always come from the column default, not from the
-- application. Same class of bug 0012 fixed for auth_resolver's
-- token_hash SELECT grant - a WHERE/column-list reference needs its own
-- privilege independent of what's actually returned or set.
GRANT INSERT (id, used_at, created_at) ON workspace_signup_invites TO platform_operator;
GRANT INSERT (id, created_at) ON platform_audit_log TO platform_operator;
