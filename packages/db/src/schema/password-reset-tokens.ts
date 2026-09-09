import { sql } from "drizzle-orm";
import { index, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

// Single-use password-reset tokens, mirroring the invitations pattern:
// an opaque high-entropy random token, only its SHA-256 hash stored, with
// "expired" as a read-time condition (expires_at < now()) rather than a
// stored state. A separate table (not a users column) because a user can
// legitimately hold more than one outstanding reset over time and each
// must be individually consumable - same "doesn't fit the entity's
// invariants, gets its own table" reasoning invitations and
// workspace_signup_invites already establish. Rows are never deleted on
// use; used_at marks them consumed (keeps an audit trail, and lets the
// atomic claim be a conditional UPDATE instead of a racy delete).
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256, not a slow hash - the token is already high-entropy random
    // (crypto.randomBytes), same reasoning as invitations.token_hash.
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("password_reset_tokens_workspace_id_idx").on(table.workspaceId),
    // The claim/consumption and any per-user cleanup both key on the user.
    index("password_reset_tokens_user_id_idx").on(table.userId),
    // Unique, matching invitations' token_hash - makes token collisions a
    // hard DB guarantee, not just astronomically unlikely.
    uniqueIndex("password_reset_tokens_token_hash_unique").on(table.tokenHash),
    pgPolicy("password_reset_tokens_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();