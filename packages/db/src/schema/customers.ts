import { sql } from "drizzle-orm";
import { index, pgPolicy, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

// Anonymous by design in Phase 1: no name/email/tags yet (04_Domain_Model.md
// and 06_Database_Design.md describe a richer Customer profile, populated
// once a pre-chat form or CRM integration exists). The widget mints/persists
// this id client-side so conversation history survives a page reload.
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("customers_workspace_id_idx").on(table.workspaceId),
    pgPolicy("customers_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
