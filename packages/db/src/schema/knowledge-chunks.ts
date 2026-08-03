import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { knowledgeSources } from "./knowledge-sources.js";
import { vector } from "./vector-type.js";
import { workspaces } from "./workspaces.js";

// voyage-3-lite's output dimension. Changing embedding providers/models
// later means re-embedding every existing chunk, not just changing this
// constant - it's captured here once so that cost is visible rather
// than buried in a magic number.
export const EMBEDDING_DIMENSIONS = 512;

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    knowledgeSourceId: uuid("knowledge_source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    chunkOrder: integer("chunk_order").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // HNSW + cosine distance - pgvector's recommended default for
    // approximate nearest-neighbor search at this scale.
    //
    // Note: HNSW doesn't natively combine with a WHERE workspace_id
    // filter the way a btree index would - Postgres applies the filter
    // to the ANN candidate set, not the index scan itself. At small
    // per-workspace chunk counts (true today) this is invisible; at
    // real scale with many workspaces sharing this table, a workspace
    // with few chunks could get fewer than `limit` results back if
    // other workspaces' chunks dominate the nearest-neighbor candidates.
    // Worth revisiting (e.g. partitioning by workspace, or tuning
    // hnsw.ef_search) if that's ever observed - not a fix this table's
    // plain index below can provide.
    index("knowledge_chunks_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    index("knowledge_chunks_workspace_id_idx").on(table.workspaceId),
    pgPolicy("knowledge_chunks_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
