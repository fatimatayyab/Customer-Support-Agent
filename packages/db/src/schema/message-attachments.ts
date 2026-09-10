import { sql } from "drizzle-orm";
import { index, integer, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { byteaType } from "./bytea-type.js";
import { conversations } from "./conversations.js";
import { messages } from "./messages.js";
import { workspaces } from "./workspaces.js";

// A file/image a customer attached to a message (Chat Widget milestone,
// docs/09's "Customer message attachments" near-term item). The blob
// lives here in Postgres (bytea) - the platform's existing storage
// infrastructure - rather than a separate blob provider that does not
// exist in this stack (see workspace-widget-settings.ts's own note on
// that). `storage_key` is the logical location a future object-store
// migration would move the blob to, so the seam is already named without
// adding a provider now.
//
// `message_id` is nullable on purpose: an upload happens before the
// message it belongs to exists. A row with message_id = NULL is a
// "pending" upload - claimed by message:send, in the same transaction
// that inserts the message, never trusted from the client. Rows that
// never get claimed (the customer closed the widget without sending)
// are orphans; cleanup is a later concern, not built speculatively.
//
// `data` is deliberately excluded from every metadata read: history
// queries must never pull bytes for a message list that only needs
// filenames/sizes. The read path is the one repository function that
// selects it, used only by the download route.
export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // Null while the upload is pending; set to the owning message's id
    // when message:send claims it. SET NULL on message deletion so an
    // attachment is never silently orphaned to a nonexistent message.
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    // The customer's original filename, display-only - never used to
    // derive anything server-side (no path, no extension-based logic).
    filename: text("filename").notNull(),
    // Stored MIME type, server-validated against an allowlist at upload
    // time and re-used verbatim as the Content-Type when served.
    mimeType: text("mime_type").notNull(),
    // Stored size in bytes, server-measured from the uploaded buffer -
    // never trusted from the client.
    size: integer("size").notNull(),
    // Logical location of the blob. Today: "{workspaceId}/{attachmentId}",
    // the row itself is the store. A future object-store swap moves the
    // bytes out and treats this as the provider key without changing any
    // application logic.
    storageKey: text("storage_key").notNull(),
    data: byteaType("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("message_attachments_workspace_id_idx").on(table.workspaceId),
    // Matches listAttachmentsByConversation's query shape (WHERE
    // conversation_id = ...) so history loading doesn't scan the whole
    // workspace's attachments for one conversation's.
    index("message_attachments_conversation_id_idx").on(table.conversationId),
    index("message_attachments_message_id_idx").on(table.messageId),
    pgPolicy("message_attachments_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();