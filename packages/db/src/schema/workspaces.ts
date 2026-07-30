import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const workspaceStatusEnum = pgEnum("workspace_status", ["active", "suspended"]);

// Workspace ids are generated in application code (crypto.randomUUID()),
// not by the database, so the id is known up front and can be used to
// SET LOCAL app.workspace_id before the owner User row is inserted in the
// same transaction. See packages/db/src/tenant-context.ts.
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    status: workspaceStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A request can only ever see/update the one workspace matching its
    // own session context - even the tenant-root table isn't exempt from
    // isolation. Insert has no prior context to check against, since the
    // workspace doesn't exist yet at the moment of creation.
    pgPolicy("workspaces_select_own", {
      for: "select",
      using: sql`${table.id} = current_setting('app.workspace_id', true)::uuid`,
    }),
    pgPolicy("workspaces_update_own", {
      for: "update",
      using: sql`${table.id} = current_setting('app.workspace_id', true)::uuid`,
    }),
    pgPolicy("workspaces_insert", {
      for: "insert",
      withCheck: sql`true`,
    }),
  ],
).enableRLS();
