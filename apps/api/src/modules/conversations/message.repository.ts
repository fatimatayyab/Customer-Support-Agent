import { and, asc, eq } from "drizzle-orm";
import { messages, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

type NewMessage = Pick<typeof messages.$inferInsert, "workspaceId" | "conversationId" | "senderType" | "content">;

export async function insertMessage(scopedDb: ScopedDb, params: NewMessage) {
  const [message] = await scopedDb.insert(messages).values(params).returning();
  return assertDefined(message, "insertMessage: INSERT ... RETURNING produced no row.");
}

export async function listMessages(scopedDb: ScopedDb, workspaceId: string, conversationId: string) {
  return scopedDb
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.workspaceId, workspaceId)))
    .orderBy(asc(messages.createdAt));
}
