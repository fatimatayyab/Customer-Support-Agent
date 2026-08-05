import { sql } from "drizzle-orm";
import { index, pgEnum, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userRoleEnum, users } from "./users.js";
import { workspaces } from "./workspaces.js";

// Deliberately not users.status = 'invited' (declared but unused): an
// invited-but-not-accepted person has no password yet, and
// users.password_hash is NOT NULL. Rather than making that nullable to
// accommodate a half-formed user row, a pending invitation gets its own
// table - same reasoning conversation_notes and integration_action_logs
// already exist for elsewhere in this codebase. Only three statuses:
// "expired" is a read-time condition (expires_at < now()), not a stored
// state a background job would need to keep fresh.
export const invitationStatusEnum = pgEnum("invitation_status", ["pending", "accepted", "revoked"]);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: userRoleEnum("role").notNull(),
    // SHA-256, not a slow hash - the token is already high-entropy random
    // (crypto.randomBytes), same reasoning as workspace_api_keys.key_hash.
    tokenHash: text("token_hash").notNull(),
    status: invitationStatusEnum("status").notNull().default("pending"),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invitations_workspace_id_idx").on(table.workspaceId),
    // Matches listPendingInvitations' actual query shape.
    index("invitations_workspace_id_status_idx").on(table.workspaceId, table.status),
    // Unique, matching workspace_api_keys' key_hash - the lookup-by-token
    // (accept flow) goes through auth_resolver, but the constraint still
    // matters: it makes token collisions a hard DB guarantee, not just
    // astronomically unlikely.
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
    // Partial unique index, not just an app-layer check: without this,
    // two concurrent invites for the same not-yet-invited email (a
    // double-click, or two admins inviting simultaneously) can both pass
    // the "no existing pending invite" read and both INSERT, producing
    // two live tokens for one address. Scoped to status = 'pending' so
    // it never conflicts with that same email's past accepted/revoked
    // history - also serves as the index getPendingInvitationByEmail's
    // query shape needs, for free.
    uniqueIndex("invitations_workspace_id_email_pending_unique")
      .on(table.workspaceId, table.email)
      .where(sql`${table.status} = 'pending'`),
    pgPolicy("invitations_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
