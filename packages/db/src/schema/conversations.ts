import { sql } from "drizzle-orm";
import { jsonb, pgEnum, pgPolicy, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers.js";
import { workspaces } from "./workspaces.js";

// Matches 04_Domain_Model.md's approved lifecycle exactly. Phase 1 only
// ever sets 'open' - the rest exist so Phase 4 (Agent Console, escalation)
// doesn't need to alter this enum's value set later.
export const conversationStatusEnum = pgEnum("conversation_status", [
  "open",
  "waiting_for_customer",
  "escalated",
  "assigned",
  "resolved",
  "closed",
]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    status: conversationStatusEnum("status").notNull().default("open"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("conversations_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
