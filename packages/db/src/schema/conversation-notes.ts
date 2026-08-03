import { sql } from "drizzle-orm";
import { index, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

// Deliberately a separate table from messages, not a new sender_type -
// see the comment on messageSenderTypeEnum in messages.ts. A note is
// structurally incapable of reaching the customer widget because
// customer-facing code paths (initiateConversation, the WS broadcast)
// never query this table at all.
export const conversationNotes = pgTable(
  "conversation_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // Not nullable - unlike messages.sender_user_id, every note has a
    // known author by construction (no anonymous/system notes exist).
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("conversation_notes_workspace_id_idx").on(table.workspaceId),
    index("conversation_notes_conversation_id_created_at_idx").on(table.conversationId, table.createdAt),
    pgPolicy("conversation_notes_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
