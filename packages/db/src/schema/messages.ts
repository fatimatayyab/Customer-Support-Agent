import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { workspaces } from "./workspaces.js";

// Types match 04_Domain_Model.md exactly. sender_user_id (to identify
// which agent sent an 'agent' message) and attachments/ai_metadata
// (06_Database_Design.md) are deliberately deferred until Phase 4 (Agent
// Console) and Phase 3 (AI Service) actually need them - nullable columns
// are cheap to add then, and nothing in this phase produces that data.
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("messages_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
