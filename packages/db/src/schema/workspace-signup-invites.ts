import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Gates who can create a brand-new workspace (POST /auth/signup) - a
// different problem from `invitations`, which gates who can join a
// workspace that already exists. No workspace_id here, deliberately:
// this table exists specifically to control access BEFORE any workspace
// exists, so there's nothing to scope it to the way every other table in
// this schema is scoped.
//
// RLS is enabled but gets zero policies - not an oversight, the point.
// app_user (every normal, tenant-scoped request) should never be able to
// read or write this table under any workspace context; RLS-enabled-
// with-no-policy is a hard deny for any non-owner, non-BYPASSRLS role.
// The only real access paths are auth_resolver's BYPASSRLS connection
// (the same "resolve a public identifier before tenant context exists"
// problem workspace_api_keys/invitations already solve - see
// auth-resolver-client.ts) for lookup + claim, and the offline
// create-signup-invite.ts script (via the migrations/superuser
// connection, same as migrate.ts) for creating one.
export const workspaceSignupInvites = pgTable(
  "workspace_signup_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    // SHA-256, not a slow hash - the token is already high-entropy random
    // (crypto.randomBytes), same reasoning as workspace_api_keys.key_hash
    // and invitations.token_hash.
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Null = unused. Set via a single conditional UPDATE ... WHERE
    // used_at IS NULL AND expires_at > now() at signup time (see
    // claimWorkspaceSignupInvite) - the same race-safe, atomic-claim
    // pattern invitations.acceptInvitation already uses for team
    // invites, applied here to the "create a workspace" case instead of
    // "join a workspace." Single-use is enforced by that guard, not just
    // documented as an expectation.
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("workspace_signup_invites_token_hash_unique").on(table.tokenHash)],
).enableRLS();
