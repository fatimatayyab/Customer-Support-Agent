import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { integrations } from "./integrations.js";
import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

export const integrationActionResultEnum = pgEnum("integration_action_result", ["success", "failure"]);

// The audit trail 02_Product_Blueprint.md requires for the Act pillar:
// "every action must be secure, auditable, and permission-controlled."
// Deliberately separate from conversation_notes/messages - this is a
// structured record for auditing, not a conversation-history display
// concern (though a successful lookup also gets a note - see
// support-orchestrator.ts's lookupContact). `action_name` is plain text
// rather than an enum: unlike conversation_status, there's no approved
// upfront list of action names to declare ahead of time.
export const integrationActionLogs = pgTable(
  "integration_action_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Nullable + SET NULL, not cascade: this is an audit trail, and an
    // audit trail's entire purpose is to survive the thing it's about
    // going away. Cascading the delete would let disconnecting (or
    // reconnecting) an integration silently erase the history of what it
    // was used for - the opposite of what 02_Product_Blueprint.md's
    // "every action must be ... auditable" is asking for. Same pattern
    // as messages.senderUserId surviving a deleted user account.
    integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    actionName: text("action_name").notNull(),
    requestParams: jsonb("request_params").notNull().default({}),
    resultStatus: integrationActionResultEnum("result_status").notNull(),
    // A short, safe-to-store summary - never the provider's raw response
    // verbatim, to avoid hoarding more third-party/customer data than the
    // audit trail actually needs.
    resultSummary: text("result_summary").notNull(),
    // Not nullable: v1 is agent-triggered only (see docs/07's Phase 5
    // notes), so every action has a real human who triggered it. Would
    // need to become nullable the day the AI can trigger one autonomously.
    triggeredByUserId: uuid("triggered_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("integration_action_logs_workspace_id_idx").on(table.workspaceId),
    // Matches "show what actions were taken in this conversation."
    index("integration_action_logs_workspace_id_conversation_id_idx").on(table.workspaceId, table.conversationId),
    pgPolicy("integration_action_logs_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
