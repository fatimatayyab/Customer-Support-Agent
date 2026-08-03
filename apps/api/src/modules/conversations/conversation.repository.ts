import { and, eq, sql } from "drizzle-orm";
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

// Matches 04_Domain_Model.md's lifecycle. Recorded reasons so a future
// Agent Console (Phase 4) can distinguish "the AI genuinely had nothing
// to go on" from "the AI answered but flagged it wants a human" from
// "the provider itself failed" - three very different situations that
// all currently land on the same conversation_status value.
export type EscalationReason =
  | "no_relevant_knowledge"
  | "low_confidence"
  | "ai_requested_escalation"
  | "ai_provider_error";

export async function escalateConversation(
  scopedDb: ScopedDb,
  workspaceId: string,
  conversationId: string,
  escalation: { reason: EscalationReason; detail: string },
): Promise<void> {
  // `detail` can contain an arbitrary caught-error message (quotes,
  // backslashes, anything) - bind it as a normal parameter and cast,
  // never hand-build the JSON into a raw SQL string.
  const escalationPayload = JSON.stringify({
    escalation: { ...escalation, escalatedAt: new Date().toISOString() },
  });

  // Merge into existing metadata (jsonb ||) rather than overwrite the
  // whole column - conversations.metadata may hold other fields later.
  await scopedDb
    .update(conversations)
    .set({
      status: "escalated",
      metadata: sql`${conversations.metadata} || ${escalationPayload}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));
}
