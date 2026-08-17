import { conversationEscalations, type ScopedDb } from "@csa/db";
import { and, asc, eq } from "drizzle-orm";
import { assertDefined } from "../../assert.js";

type NewConversationEscalation = Pick<
  typeof conversationEscalations.$inferInsert,
  "workspaceId" | "conversationId" | "reason" | "detail" | "escalatedAt"
>;

// Insert-only - this is an append-only history, nothing ever updates or
// removes a row (see the schema file's own comment on why).
export async function insertConversationEscalation(scopedDb: ScopedDb, params: NewConversationEscalation) {
  const [escalation] = await scopedDb.insert(conversationEscalations).values(params).returning();
  return assertDefined(escalation, "insertConversationEscalation: INSERT ... RETURNING produced no row.");
}

export async function listConversationEscalations(scopedDb: ScopedDb, workspaceId: string, conversationId: string) {
  return scopedDb
    .select()
    .from(conversationEscalations)
    .where(
      and(eq(conversationEscalations.workspaceId, workspaceId), eq(conversationEscalations.conversationId, conversationId)),
    )
    .orderBy(asc(conversationEscalations.escalatedAt));
}
