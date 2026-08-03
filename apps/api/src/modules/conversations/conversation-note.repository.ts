import { and, asc, eq } from "drizzle-orm";
import { conversationNotes, users, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

type NewConversationNote = Pick<typeof conversationNotes.$inferInsert, "workspaceId" | "conversationId" | "userId" | "content">;

export async function insertConversationNote(scopedDb: ScopedDb, params: NewConversationNote) {
  const [note] = await scopedDb.insert(conversationNotes).values(params).returning();
  return assertDefined(note, "insertConversationNote: INSERT ... RETURNING produced no row.");
}

// Never called from any widget-facing code path - see the comment on
// messageSenderTypeEnum in packages/db/src/schema/messages.ts for why
// notes live in their own table instead of the messages table.
export async function listConversationNotes(scopedDb: ScopedDb, workspaceId: string, conversationId: string) {
  return scopedDb
    .select({
      id: conversationNotes.id,
      conversationId: conversationNotes.conversationId,
      userId: conversationNotes.userId,
      authorName: users.name,
      content: conversationNotes.content,
      createdAt: conversationNotes.createdAt,
    })
    .from(conversationNotes)
    .innerJoin(users, eq(conversationNotes.userId, users.id))
    .where(and(eq(conversationNotes.conversationId, conversationId), eq(conversationNotes.workspaceId, workspaceId)))
    .orderBy(asc(conversationNotes.createdAt));
}
