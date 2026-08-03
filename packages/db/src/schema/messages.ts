import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { workspaces } from "./workspaces.js";

// Types match 04_Domain_Model.md exactly. sender_user_id (to identify
// which agent sent an 'agent' message) and attachments are deliberately
// deferred until Phase 4 (Agent Console) actually needs them - nullable
// columns are cheap to add then, and nothing in this phase produces
// that data.
export const messageSenderTypeEnum = pgEnum("message_sender_type", ["customer", "agent", "system", "ai"]);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderType: messageSenderTypeEnum("sender_type").notNull(),
    content: text("content").notNull(),
    // Sparse by design - only 'ai' messages populate this today (provider,
    // model, confidence, citations, token usage, finish reason). Nullable
    // rather than a default '{}' like other tables' metadata columns,
    // because most messages (customer/system) genuinely never have any.
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("messages_workspace_id_idx").on(table.workspaceId),
    // Matches listMessages' actual query shape (WHERE conversation_id = ...
    // ORDER BY created_at) so history retrieval doesn't scan every message
    // in the workspace to find one conversation's.
    index("messages_conversation_id_created_at_idx").on(table.conversationId, table.createdAt),
    pgPolicy("messages_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
