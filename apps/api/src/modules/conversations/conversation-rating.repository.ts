import { conversationRatings, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

export type ConversationRatingValue = (typeof conversationRatings.$inferSelect)["rating"];

type NewConversationRating = Pick<typeof conversationRatings.$inferInsert, "workspaceId" | "conversationId" | "rating">;

// Upsert, not insert - conversation_ratings has a unique index on
// conversation_id (see the schema comment), so a customer changing
// their mind updates the same row instead of erroring or duplicating.
// This is also what makes the widget's submission safely retryable/
// resubmittable with no "already rated" check needed on either side.
export async function upsertConversationRating(scopedDb: ScopedDb, params: NewConversationRating) {
  const [rating] = await scopedDb
    .insert(conversationRatings)
    .values(params)
    .onConflictDoUpdate({
      target: conversationRatings.conversationId,
      set: { rating: params.rating, updatedAt: new Date() },
    })
    .returning();
  return assertDefined(rating, "upsertConversationRating: INSERT ... RETURNING produced no row.");
}
