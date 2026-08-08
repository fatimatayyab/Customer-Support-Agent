import { sql } from "drizzle-orm";
import { index, pgEnum, pgPolicy, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";
import { workspaces } from "./workspaces.js";

export const conversationRatingValueEnum = pgEnum("conversation_rating_value", ["up", "down"]);

export const conversationRatings = pgTable(
  "conversation_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    rating: conversationRatingValueEnum("rating").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One rating per conversation, not one row per submission - a
    // customer changing their mind updates this row (see
    // upsertConversationRating's ON CONFLICT), it doesn't create a
    // second one. This is also what makes the rating idempotent from
    // the widget's side: resubmitting is always safe.
    uniqueIndex("conversation_ratings_conversation_id_unique").on(table.conversationId),
    // Matches analytics.repository.ts's actual query shape (WHERE
    // workspace_id = ... AND created_at >= ... GROUP BY rating), same
    // pattern as knowledge_sources' identical composite index.
    index("conversation_ratings_workspace_id_created_at_idx").on(table.workspaceId, table.createdAt),
    pgPolicy("conversation_ratings_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
