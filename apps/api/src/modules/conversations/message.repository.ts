import { and, asc, eq } from "drizzle-orm";
import { messages, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

// Extensible on purpose - only 'ai' messages populate this today, but
// the shape is deliberately generic (provider/model rather than
// "anthropicModel") so a future non-Claude provider doesn't need a
// schema or type change, just a different value for these same fields.
export interface AiMessageMetadata {
  provider: string;
  model: string;
  promptVersion: number;
  confidence: number;
  citations: { knowledgeChunkId: string; knowledgeSourceId: string; similarity: number }[];
  usage: { inputTokens: number; outputTokens: number };
  finishReason: string;
}

type NewMessage = Pick<typeof messages.$inferInsert, "workspaceId" | "conversationId" | "senderType" | "content"> & {
  metadata?: AiMessageMetadata;
};

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
