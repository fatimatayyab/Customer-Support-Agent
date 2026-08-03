import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

// Types match 04_Domain_Model.md exactly. Internal agent-to-agent notes
// are NOT a message type - they live in conversation-notes.ts, a
// separate table. Reusing this enum for notes would mean every current
// and future query/broadcast against messages has to remember to
// exclude them, or a note leaks straight to the customer's widget. A
// separate table makes that structurally impossible instead of relying
// on discipline. Attachments are still deferred - no phase produces
// that data yet.
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
    // Only populated for sender_type = 'agent' - which specific user sent
    // it. SET NULL on user deletion so message history survives a
    // departed agent's account being removed.
    senderUserId: uuid("sender_user_id").references(() => users.id, { onDelete: "set null" }),
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
