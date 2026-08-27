import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { integrations } from "./integrations.js";
import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

export const integrationActionResultEnum = pgEnum("integration_action_result", ["success", "failure"]);

// Added when the AI itself gained the ability to trigger a lookup
// (Support Orchestrator Stage 1, see docs/07) - "who triggered this" is
// now a real two-way fact, not always a human. A nullable
// triggered_by_user_id alone would have made NULL silently mean "the AI
// did it", which is exactly the kind of overloaded-null ambiguity this
// codebase avoids elsewhere; an explicit enum keeps "absent" and
// "not human" as distinct concepts.
export const integrationActionTriggerEnum = pgEnum("integration_action_trigger", ["human", "ai"]);

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
    // "That day" (see the old comment this replaced) - the AI can now
    // trigger a lookup autonomously (Orchestrator Stage 1), so this is
    // nullable and paired with triggeredBy below: populated only when
    // triggeredBy = 'human', NULL when 'ai'. Never NULL for an unknown/
    // absent reason - triggeredBy always says which case it is.
    triggeredBy: integrationActionTriggerEnum("triggered_by").notNull(),
    triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id),
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
