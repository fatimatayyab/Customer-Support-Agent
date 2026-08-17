import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// A platform admin is a structurally separate identity from a workspace
// User - it manages the platform itself (provisioning/suspending
// workspaces), not a tenant. No workspace_id, deliberately: same
// reasoning as workspace_signup_invites, this table exists specifically
// to control something BEFORE/ACROSS workspace boundaries, so there's
// nothing to scope it to.
export const platformAdminStatusEnum = pgEnum("platform_admin_status", ["active", "disabled"]);

// RLS is enabled but gets zero policies - not an oversight, the point
// (same pattern as workspace_signup_invites). app_user, under any
// workspace context, should never be able to read or write this table.
// The only access path is the platform_operator role (BYPASSRLS, narrow
// column grants - see packages/db/src/platform-operator-client.ts) plus
// the offline create-platform-admin.ts bootstrap script (via the
// migrations/superuser connection, same as create-signup-invite.ts).
export const platformAdmins = pgTable(
  "platform_admins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    status: platformAdminStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("platform_admins_email_unique").on(table.email)],
).enableRLS();
