import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgPolicy, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers.js";
import { users } from "./users.js";
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
    // Nullable: unassigned is the normal starting state. SET NULL (not
    // cascade) on user deletion - losing who a conversation is assigned
    // to shouldn't delete the conversation itself. This is the field
    // that actually silences the AI (see support-orchestrator.ts) - the
    // status enum's 'assigned' value is descriptive, this column is the
    // source of truth handleCustomerMessage reads.
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    status: conversationStatusEnum("status").notNull().default("open"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("conversations_workspace_id_idx").on(table.workspaceId),
    // Matches the Agent Console's two real queue views: the
    // unassigned/escalated queue (filter by status) and "my
    // conversations" (filter by assignee).
    index("conversations_workspace_id_status_idx").on(table.workspaceId, table.status),
    index("conversations_workspace_id_assigned_user_id_idx").on(table.workspaceId, table.assignedUserId),
    // The "All" queue tab has no status/assignee filter - just
    // workspace_id with ORDER BY updated_at DESC. Without this, that
    // query falls back to an in-memory sort over every conversation in
    // the workspace once there are enough to matter.
    index("conversations_workspace_id_updated_at_idx").on(table.workspaceId, table.updatedAt),
    pgPolicy("conversations_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
