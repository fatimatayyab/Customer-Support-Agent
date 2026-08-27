import { and, asc, eq } from "drizzle-orm";
import { messages, users, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";
import type { EscalationReason } from "./conversation.repository.js";

// Extensible on purpose - the provider/model/etc. fields are deliberately
// generic (not "anthropicModel") so a future non-Claude provider doesn't
// need a schema or type change, just a different value for the same
// fields. All optional on one shared shape rather than a union: an 'ai'
// message populates the provider/confidence fields, a 'system' fallback
// message (or an 'ai' message that itself triggered escalation) populates
// escalated/escalationReason instead - both are the same jsonb column, and
// a message can carry either subset without needing a discriminated type.
export interface MessageMetadata {
  provider?: string;
  model?: string;
  promptVersion?: number;
  confidence?: number;
  citations?: { knowledgeChunkId: string; knowledgeSourceId: string; similarity: number }[];
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: string;
  escalated?: boolean;
  escalationReason?: EscalationReason;
  // Populated only on 'customer' messages, only when the website widget
  // sent one (docs/00/02's Chat Widget direction - channel-specific
  // context, not assumed present for every message/channel).
  pageUrl?: string;
  pageTitle?: string;
  // Populated only on an 'ai' message that used the bounded tool-call
  // flow (Support Orchestrator Stage 1) - reused jsonb metadata, same
  // reasoning as escalated/escalationReason, rather than a new Postgres
  // enum for a single-tool feature (see conversation-escalations.ts's
  // own comment on why EscalationReason itself isn't a DB enum).
  toolAttempted?: "lookup_contact";
  toolOutcome?: "found" | "not_found" | "error";
}

type NewMessage = Pick<
  typeof messages.$inferInsert,
  "workspaceId" | "conversationId" | "senderType" | "content" | "senderUserId"
> & {
  metadata?: MessageMetadata;
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
