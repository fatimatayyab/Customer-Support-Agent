import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { conversations, users, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";
import { insertConversationEscalation } from "./conversation-escalation.repository.js";

export type ConversationStatus = (typeof conversations.$inferSelect)["status"];

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

const conversationWithAssigneeColumns = {
  id: conversations.id,
  workspaceId: conversations.workspaceId,
  customerId: conversations.customerId,
  status: conversations.status,
  assignedUserId: conversations.assignedUserId,
  assignedUserName: users.name,
  metadata: conversations.metadata,
  createdAt: conversations.createdAt,
  updatedAt: conversations.updatedAt,
};

export interface ConversationFilter {
  status?: ConversationStatus;
  // undefined = no assignment filter, null = unassigned only, a string = that specific assignee
  assignedUserId?: string | null;
}

// Joins the assignee's name directly rather than standing up a separate
// "list workspace users" endpoint just to resolve an id to a display
// name in the dashboard - see docs/07's Phase 4 notes for why.
export async function listConversations(scopedDb: ScopedDb, workspaceId: string, filter: ConversationFilter = {}) {
  const conditions = [eq(conversations.workspaceId, workspaceId)];
  if (filter.status) {
    conditions.push(eq(conversations.status, filter.status));
  }
  if (filter.assignedUserId === null) {
    conditions.push(isNull(conversations.assignedUserId));
  } else if (filter.assignedUserId) {
    conditions.push(eq(conversations.assignedUserId, filter.assignedUserId));
  }

  return scopedDb
    .select(conversationWithAssigneeColumns)
    .from(conversations)
    .leftJoin(users, eq(conversations.assignedUserId, users.id))
    .where(and(...conditions))
    .orderBy(desc(conversations.updatedAt));
}

export async function getConversationDetail(scopedDb: ScopedDb, workspaceId: string, id: string) {
  const [conversation] = await scopedDb
    .select(conversationWithAssigneeColumns)
    .from(conversations)
    .leftJoin(users, eq(conversations.assignedUserId, users.id))
    .where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)))
    .limit(1);
  return conversation ?? null;
}

// The field that actually silences the AI (support-orchestrator.ts
// reads assignedUserId, not status) - 'assigned' here is descriptive
// state for the UI, not the source of truth the Orchestrator checks.
export async function assignConversation(
  scopedDb: ScopedDb,
  workspaceId: string,
  conversationId: string,
  userId: string,
): Promise<void> {
  await scopedDb
    .update(conversations)
    .set({ assignedUserId: userId, status: "assigned", updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));
}

export async function updateConversationStatus(
  scopedDb: ScopedDb,
  workspaceId: string,
  conversationId: string,
  status: ConversationStatus,
): Promise<void> {
  await scopedDb
    .update(conversations)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));
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
  | "ai_provider_error"
  | "customer_requested_human";

// Writes to two places on every call, not just one: conversations.metadata
// stays a cheap "current reason" snapshot (existing readers - the queue
// badge, analytics.repository.ts's breakdown - only ever want "what's
// this conversation escalated for right now"), while
// conversation_escalations gets a new, permanent row - a conversation
// that escalates more than once, for different reasons, over its
// lifetime must not lose the earlier ones just because a later one
// happened. Both writes happen inside the same scopedDb call, so they
// share whatever transaction the caller is already in.
export async function escalateConversation(
  scopedDb: ScopedDb,
  workspaceId: string,
  conversationId: string,
  escalation: { reason: EscalationReason; detail: string },
): Promise<void> {
  const escalatedAt = new Date();

  // `detail` can contain an arbitrary caught-error message (quotes,
  // backslashes, anything) - bind it as a normal parameter and cast,
  // never hand-build the JSON into a raw SQL string.
  const escalationPayload = JSON.stringify({
    escalation: { ...escalation, escalatedAt: escalatedAt.toISOString() },
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

  await insertConversationEscalation(scopedDb, {
    workspaceId,
    conversationId,
    reason: escalation.reason,
    detail: escalation.detail,
    escalatedAt,
  });
}

export async function saveConversationSummary(
  scopedDb: ScopedDb,
  workspaceId: string,
  conversationId: string,
  summary: {
    text: string;
    provider: string;
    model: string;
    promptVersion: number;
    usage: { inputTokens: number; outputTokens: number };
  },
): Promise<void> {
  const summaryPayload = JSON.stringify({
    aiSummary: { ...summary, generatedAt: new Date().toISOString() },
  });

  await scopedDb
    .update(conversations)
    .set({
      metadata: sql`${conversations.metadata} || ${summaryPayload}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));
}
