import { and, asc, eq } from "drizzle-orm";
import { messages, users, type ScopedDb } from "@csa/db";
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

type NewMessage = Pick<
  typeof messages.$inferInsert,
  "workspaceId" | "conversationId" | "senderType" | "content" | "senderUserId"
> & {
  metadata?: AiMessageMetadata;
};

export async function insertMessage(scopedDb: ScopedDb, params: NewMessage) {
  const [message] = await scopedDb.insert(messages).values(params).returning();
  return assertDefined(message, "insertMessage: INSERT ... RETURNING produced no row.");
}

// Joins the sender's name for 'agent' messages (history reads "Sarah:",
// not "agent:") - used by both the Orchestrator's AI-context loading
// and the Agent Console's history view, rather than two near-identical
// functions. RLS on `users` composes correctly here since this always
// runs inside the same workspace-scoped transaction.
export async function listMessages(scopedDb: ScopedDb, workspaceId: string, conversationId: string) {
  return scopedDb
    .select({
      id: messages.id,
      workspaceId: messages.workspaceId,
      conversationId: messages.conversationId,
      senderType: messages.senderType,
      senderUserId: messages.senderUserId,
      senderName: users.name,
      content: messages.content,
      metadata: messages.metadata,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .leftJoin(users, eq(messages.senderUserId, users.id))
    .where(and(eq(messages.conversationId, conversationId), eq(messages.workspaceId, workspaceId)))
    .orderBy(asc(messages.createdAt));
}
