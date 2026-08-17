import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import { handleCustomerMessage, initiateConversation } from "../../orchestrator/support-orchestrator.js";
import { checkRateLimit, rateLimitByWorkspace, RateLimitExceededError } from "../../rate-limit.js";
import { redisClient } from "../../redis-client.js";
import { requireApiKey } from "../workspace-identification/require-api-key.js";
import { publishToConversation, subscribe, unsubscribe } from "./conversation-hub.js";
import { issueWidgetWsTicket, verifyWidgetWsTicket } from "./widget-ws-ticket.js";

// Workspace-keyed, not IP-keyed - the risk here is aggregate volume
// against one workspace's key (every ticket issued can lead to a new
// conversation, each of which can trigger a real AI call), not a single
// visitor's request rate. Generous on purpose: a genuinely busy client's
// site can have many concurrent visitors opening the widget within the
// same minute, and this exists to catch a runaway/malicious script
// hammering the endpoint, not to throttle normal traffic spikes - raise
// it if a real client ever legitimately hits it.
const WIDGET_SESSION_RATE_LIMIT = rateLimitByWorkspace(redisClient, "widget-session", 120, 60);

// The actual AI-cost trigger point in this whole codebase: every
// message:send that reaches an unassigned conversation fires a real
// AI-generation call (support-orchestrator.ts). @fastify/rate-limit
// can't reach this - it's a WebSocket message, not an HTTP request -
// so this is checked directly, keyed per-conversation rather than
// per-workspace: the risk is one runaway/malicious client script in a
// single chat, not a workspace's overall volume (which the knowledge-
// ingestion limit already treats differently, since that's about a
// workspace's own uploads, not one customer's chat behavior).
const WS_MESSAGE_RATE_LIMIT = { max: 20, windowSeconds: 60 };

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
  app.post("/widget/session", { preHandler: [requireApiKey, WIDGET_SESSION_RATE_LIMIT] }, async (request, reply) => {
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
        await checkRateLimit(
          redisClient,
          `rl:ws-message:${message.payload.conversationId}`,
          WS_MESSAGE_RATE_LIMIT.max,
          WS_MESSAGE_RATE_LIMIT.windowSeconds,
        );
        await handleCustomerMessage({ workspaceId, ...message.payload });
        return;
      }

      // typing:start / typing:stop - ephemeral, not persisted.
      publishToConversation(message.payload.conversationId, { type: message.type, payload: {} }, socket);
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        // Expected, routine rejection under abuse/bug conditions - not
        // an application error, so it doesn't get logged as one.
        send(socket, { type: "error", payload: { message: error.message } });
        return;
      }
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
