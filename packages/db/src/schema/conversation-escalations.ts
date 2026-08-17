import { sql } from "drizzle-orm";
import { index, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { workspaces } from "./workspaces.js";

// Append-only history of every escalation event on a conversation.
// conversations.metadata.escalation (the jsonb key escalateConversation
// also writes, in conversation.repository.ts) stays a cheap "what's the
// *current* reason" snapshot for existing readers (the dashboard's
// queue badge, analytics.repository.ts's escalation-reason breakdown) -
// but a conversation can escalate more than once, for different
// reasons, over its lifetime, and a human working the case needs to see
// all of them, not just whichever one happened last. Plain text `reason`
// column, not a pgEnum - EscalationReason isn't a Postgres enum anywhere
// else either, since conversations.metadata is untyped jsonb.
export const conversationEscalations = pgTable(
  "conversation_escalations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    detail: text("detail").notNull().default(""),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Matches the real query shape - "every escalation for this
    // conversation, in order" (conversation.routes.ts's detail response,
    // and the Orchestrator's Airtable-history-summary builder) - and
    // this composite already satisfies CLAUDE.md §8's "an index touching
    // workspace_id" requirement, so no separate bare index is needed.
    index("conversation_escalations_workspace_id_conversation_id_idx").on(table.workspaceId, table.conversationId),
    pgPolicy("conversation_escalations_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
