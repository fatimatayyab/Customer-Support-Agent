import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import { handleCustomerMessage, initiateConversation } from "../../orchestrator/support-orchestrator.js";
import { requireApiKey } from "../workspace-identification/require-api-key.js";
import { publishToConversation, subscribe, unsubscribe } from "./conversation-hub.js";
import { issueWidgetWsTicket, verifyWidgetWsTicket } from "./widget-ws-ticket.js";

const initiateMessageSchema = z.object({
  type: z.literal("conversation:initiate"),
  payload: z.object({
    customerId: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
  }),
});

const sendMessageSchema = z.object({
  type: z.literal("message:send"),
  payload: z.object({
    conversationId: z.string().uuid(),
    content: z.string().min(1).max(4000),
  }),
});

const typingMessageSchema = z.object({
  type: z.enum(["typing:start", "typing:stop"]),
  payload: z.object({ conversationId: z.string().uuid() }),
});

const incomingMessageSchema = z.union([initiateMessageSchema, sendMessageSchema, typingMessageSchema]);

export async function widgetRealtimeRoutes(app: FastifyInstance) {
  // Step 1 of the WS handshake workaround: exchange the widget's API
  // key for a short-lived ticket over plain REST, where the X-API-Key
  // header still works normally.
  app.post("/widget/session", { preHandler: requireApiKey }, async (request, reply) => {
    const ticket = await issueWidgetWsTicket(request.workspaceId!);
    reply.send({ ticket });
  });

  // Step 2: open the actual WebSocket using that ticket instead of the
  // API key.
  app.get("/widget/ws", { websocket: true }, (socket, request) => {
    void handleConnection(socket, request);
  });
}

async function handleConnection(socket: WebSocket, request: FastifyRequest): Promise<void> {
  const query = request.query as { ticket?: string };
  const claims = query.ticket ? await verifyWidgetWsTicket(query.ticket) : null;

  if (!claims) {
    socket.close(4401, "Invalid or expired ticket.");
    return;
  }

  const workspaceId = claims.workspaceId;
  let subscribedConversationId: string | null = null;

  socket.on("message", (raw: Buffer) => {
    void onMessage(raw);
  });

  async function onMessage(raw: Buffer): Promise<void> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "error", payload: { message: "Message must be valid JSON." } });
      return;
    }

    const result = incomingMessageSchema.safeParse(parsedJson);
    if (!result.success) {
      send(socket, { type: "error", payload: { message: "Invalid message shape." } });
      return;
    }
    const message = result.data;

    try {
      if (message.type === "conversation:initiate") {
        const outcome = await initiateConversation({ workspaceId, ...message.payload });

        if (subscribedConversationId) {
          unsubscribe(subscribedConversationId, socket);
        }
        subscribedConversationId = outcome.conversation.id;
        subscribe(subscribedConversationId, socket);

        send(socket, { type: "conversation:initiated", payload: outcome });
        return;
      }

      // Every other message type requires an already-initiated
      // conversation, and only the one this socket is subscribed to -
      // a client can't push messages into a conversation it hasn't
      // proven (via conversation:initiate) it owns.
      if (message.payload.conversationId !== subscribedConversationId) {
        send(socket, { type: "error", payload: { message: "Not subscribed to this conversation." } });
        return;
      }

      if (message.type === "message:send") {
        await handleCustomerMessage({ workspaceId, ...message.payload });
        return;
      }

      // typing:start / typing:stop - ephemeral, not persisted.
      publishToConversation(message.payload.conversationId, { type: message.type, payload: {} }, socket);
    } catch (error) {
      send(socket, { type: "error", payload: { message: "Something went wrong." } });
      request.log.error(error);
    }
  }

  socket.on("close", () => {
    if (subscribedConversationId) {
      unsubscribe(subscribedConversationId, socket);
    }
  });
}

function send(socket: WebSocket, event: { type: string; payload: unknown }): void {
  socket.send(JSON.stringify(event));
}
