import { and, eq } from "drizzle-orm";
import { conversations, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

export async function insertConversation(scopedDb: ScopedDb, params: { workspaceId: string; customerId: string }) {
  const [conversation] = await scopedDb.insert(conversations).values(params).returning();
  return assertDefined(conversation, "insertConversation: INSERT ... RETURNING produced no row.");
}

export async function getConversationById(scopedDb: ScopedDb, workspaceId: string, id: string) {
  const [conversation] = await scopedDb
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)))
    .limit(1);
  return conversation ?? null;
}
