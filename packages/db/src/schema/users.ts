import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

// Matches the Domain Model exactly: a User belongs to exactly one
// Workspace. No cross-workspace membership table - if that need shows up
// later, it's a deliberate change to the domain model, not a default we
// should have built in speculatively.
export const userRoleEnum = pgEnum("user_role", ["owner", "administrator", "support_agent"]);
export const userStatusEnum = pgEnum("user_status", ["invited", "active", "disabled"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Email is unique per workspace, not globally - the same person can
    // hold separate accounts in separate workspaces under this model.
    uniqueIndex("users_workspace_email_unique").on(table.workspaceId, table.email),
    pgPolicy("users_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
