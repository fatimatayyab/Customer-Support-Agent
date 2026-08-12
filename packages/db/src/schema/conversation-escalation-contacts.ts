import { sql } from "drizzle-orm";
import { index, pgEnum, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { workspaces } from "./workspaces.js";

export const escalationContactMethodEnum = pgEnum("escalation_contact_method", ["email", "phone"]);

// Mirrors integration_action_logs' status vocabulary, but scoped to this
// row specifically - integration_action_logs stays the append-only audit
// history, this column is the fast, joinable "does this still need a
// retry" read the dashboard filters/displays on.
export const escalationContactSyncStatusEnum = pgEnum("escalation_contact_sync_status", [
  "pending",
  "synced",
  "failed",
]);

// One row per conversation (conversations.customers stays anonymous by
// design - see customers.ts - this table holds only what the customer
// explicitly gave us when asking for a human, not a general profile).
export const conversationEscalationContacts = pgTable(
  "conversation_escalation_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contactMethod: escalationContactMethodEnum("contact_method").notNull(),
    contactValue: text("contact_value").notNull(),
    // Snapshotted from conversations.metadata.escalation at the moment
    // this contact is captured, not read live at sync time - that field
    // gets overwritten by every later escalation event on the same
    // conversation (see escalateConversation's jsonb merge), so a live
    // read at sync time could attach the wrong reason to a contact
    // captured in response to an earlier, different escalation. Plain
    // text, not a pgEnum - EscalationReason itself isn't a Postgres enum
    // either (conversations.metadata is untyped jsonb), so this mirrors
    // that.
    escalationReason: text("escalation_reason").notNull(),
    escalationDetail: text("escalation_detail").notNull().default(""),
    // Tracks the sync into the platform's single internal Airtable
    // escalation mirror (modules/ops/) - not a per-workspace connection,
    // see integrations.ts's comment on why Airtable isn't in that table.
    // Platform-internal only: never surfaced in the workspace-facing
    // dashboard.
    airtableSyncStatus: escalationContactSyncStatusEnum("airtable_sync_status").notNull().default("pending"),
    // Set once the first sync succeeds - a corrected resubmission updates
    // this same Airtable record via PATCH instead of POSTing a second,
    // duplicate one.
    airtableRecordId: text("airtable_record_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One contact per conversation - a customer resubmitting the form
    // (e.g. correcting a typo) updates this row, same upsert-on-conflict
    // pattern as conversation_ratings.
    uniqueIndex("conversation_escalation_contacts_conversation_id_unique").on(table.conversationId),
    index("conversation_escalation_contacts_workspace_id_created_at_idx").on(table.workspaceId, table.createdAt),
    pgPolicy("conversation_escalation_contacts_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
