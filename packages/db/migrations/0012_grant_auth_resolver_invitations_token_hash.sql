-- Custom SQL migration file, put your code below! --

-- Fixes a real bug caught during live testing: 0011's grant covered the
-- columns findInvitationByTokenHash *returns*, but Postgres requires
-- column-level SELECT privilege on every column a query references
-- anywhere, including WHERE clause conditions - not just the selected
-- ones. token_hash is filtered on but was never granted, so every
-- accept-flow lookup failed with "permission denied for table
-- invitations". workspace_api_keys' existing grant already includes
-- key_hash for the exact same reason; this one should have matched it
-- from the start.
GRANT SELECT (token_hash) ON invitations TO auth_resolver;
