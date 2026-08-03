import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

// Matches 04_Domain_Model.md's supported source types exactly. Phase 2
// only implements ingestion for 'plain_text' and 'faq' - 'pdf', 'docx',
// and 'website' are represented here so the schema doesn't need to
// change when those are built, but the ingestion service rejects them
// for now rather than pretending to support them.
export const knowledgeSourceTypeEnum = pgEnum("knowledge_source_type", [
  "website",
  "pdf",
  "docx",
  "faq",
  "plain_text",
]);

export const knowledgeSourceStatusEnum = pgEnum("knowledge_source_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: knowledgeSourceTypeEnum("type").notNull(),
    title: text("title").notNull(),
    // Populated directly for plain_text/faq. Reserved for a URL or file
    // path once pdf/docx/website ingestion exists - not used yet.
    sourceLocation: text("source_location"),
    content: text("content"),
    status: knowledgeSourceStatusEnum("status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Matches listKnowledgeSources' actual query shape (WHERE workspace_id
    // = ... ORDER BY created_at DESC).
    index("knowledge_sources_workspace_id_created_at_idx").on(table.workspaceId, table.createdAt),
    pgPolicy("knowledge_sources_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
