import { withWorkspaceContext } from "@csa/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NotFoundError } from "../../errors.js";
import {
  addInternalNote,
  claimConversation,
  changeConversationStatus,
  lookupContact,
  sendAgentMessage,
  suggestReplyForAgent,
  summarizeConversationForAgent,
} from "../../orchestrator/support-orchestrator.js";
import { requireSession } from "../auth/require-session.js";
import { getEscalationContactByConversationId } from "./conversation-escalation-contact.repository.js";
import { listConversationNotes } from "./conversation-note.repository.js";
import { getConversationDetail, listConversations, type ConversationStatus } from "./conversation.repository.js";
import { listMessages } from "./message.repository.js";

const CONVERSATION_STATUSES: ConversationStatus[] = [
  "open",
  "waiting_for_customer",
  "escalated",
  "assigned",
  "resolved",
  "closed",
];

const listQuerySchema = z.object({
  status: z.enum(CONVERSATION_STATUSES as [ConversationStatus, ...ConversationStatus[]]).optional(),
  assigned: z.enum(["me", "unassigned"]).optional(),
});

const sendMessageSchema = z.object({ content: z.string().min(1).max(4000) });
const addNoteSchema = z.object({ content: z.string().min(1).max(4000) });
// Deliberately a narrower set than the full lifecycle enum - 'assigned'
// only happens via claimConversation, 'escalated' only via the AI's own
// escalation path. This endpoint is for the explicit human actions of
// resolving, closing, or reopening a conversation.
const updateStatusSchema = z.object({ status: z.enum(["open", "resolved", "closed"]) });
const contactLookupSchema = z.object({ email: z.string().email() });

// Dashboard-facing: session-cookie authenticated, same as workspace.routes.ts
// and knowledge.routes.ts. No role restriction beyond requireSession -
// per 04_Domain_Model.md, handling conversations is support_agent's core
// job, unlike Knowledge (owner/administrator only).
export async function conversationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);

  app.get("/conversations", async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const filter: { status?: ConversationStatus; assignedUserId?: string | null } = {};
    if (query.status) {
      filter.status = query.status;
    }
    if (query.assigned === "me") {
      filter.assignedUserId = request.sessionUser!.userId;
    } else if (query.assigned === "unassigned") {
      filter.assignedUserId = null;
    }

    const result = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      listConversations(scopedDb, request.workspaceId!, filter),
    );
    reply.send({ conversations: result });
  });

  app.get<{ Params: { id: string } }>("/conversations/:id", async (request, reply) => {
    const result = await withWorkspaceContext(request.workspaceId!, async (scopedDb) => {
      const conversation = await getConversationDetail(scopedDb, request.workspaceId!, request.params.id);
      if (!conversation) {
        return null;
      }
      const [conversationMessages, notes, escalationContact] = await Promise.all([
        listMessages(scopedDb, request.workspaceId!, request.params.id),
        listConversationNotes(scopedDb, request.workspaceId!, request.params.id),
        getEscalationContactByConversationId(scopedDb, request.workspaceId!, request.params.id),
      ]);
      return { conversation, messages: conversationMessages, notes, escalationContact };
    });

    if (!result) {
      throw new NotFoundError("Conversation not found.");
    }
    reply.send(result);
  });

  app.post<{ Params: { id: string } }>("/conversations/:id/claim", async (request, reply) => {
    await claimConversation(request.workspaceId!, request.params.id, request.sessionUser!.userId);
    reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/conversations/:id/messages", async (request, reply) => {
    const body = sendMessageSchema.parse(request.body);
    const message = await sendAgentMessage(
      request.workspaceId!,
      request.params.id,
      request.sessionUser!.userId,
      body.content,
    );
    reply.code(201).send({ message });
  });

  app.post<{ Params: { id: string } }>("/conversations/:id/notes", async (request, reply) => {
    const body = addNoteSchema.parse(request.body);
    const note = await addInternalNote(request.workspaceId!, request.params.id, request.sessionUser!.userId, body.content);
    reply.code(201).send({ note });
  });

  app.post<{ Params: { id: string } }>("/conversations/:id/suggest-reply", async (request, reply) => {
    const suggestion = await suggestReplyForAgent(request.workspaceId!, request.params.id);
    reply.send({ suggestion });
  });

  app.post<{ Params: { id: string } }>("/conversations/:id/summarize", async (request, reply) => {
    const summary = await summarizeConversationForAgent(request.workspaceId!, request.params.id);
    reply.send({ summary });
  });

  app.patch<{ Params: { id: string } }>("/conversations/:id/status", async (request, reply) => {
    const body = updateStatusSchema.parse(request.body);
    await changeConversationStatus(request.workspaceId!, request.params.id, body.status);
    reply.code(204).send();
  });

  // Specific route name, not /actions/:actionName - there's exactly one
  // action today (Phase 5). A generic dispatch shape is a decision to
  // make once a second action exists to generalize from, not before.
  app.post<{ Params: { id: string } }>("/conversations/:id/actions/contact-lookup", async (request, reply) => {
    const body = contactLookupSchema.parse(request.body);
    const result = await lookupContact(request.workspaceId!, request.params.id, request.sessionUser!.userId, body.email);
    reply.send({ result });
  });
}
