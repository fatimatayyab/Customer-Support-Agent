import { withWorkspaceContext } from "@csa/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import { getConversationById } from "../conversations/conversation.repository.js";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../auth/session-token.js";
import { subscribe, unsubscribe } from "./conversation-hub.js";

const watchMessageSchema = z.object({
  type: z.literal("conversation:watch"),
  payload: z.object({ conversationId: z.string().uuid() }),
});

const unwatchMessageSchema = z.object({
  type: z.literal("conversation:unwatch"),
  payload: z.object({}),
});

const incomingMessageSchema = z.union([watchMessageSchema, unwatchMessageSchema]);

/**
 * Read-only from the dashboard's side: this connection only ever
 * receives broadcasts (message:receive, typing:start/stop) - sending a
 * reply, claiming, adding a note etc. all go through conversation.routes.ts
 * over plain REST, same as every other dashboard action. This socket's
 * only job is watching one conversation at a time for live updates,
 * mirroring the widget's single-conversation subscription model rather
 * than trying to fan out a whole queue view over one connection.
 *
 * Auth is simpler than the widget's ticket dance: the dashboard already
 * authenticates with an httpOnly session cookie, and browsers attach
 * cookies to a same-origin WS handshake automatically (unlike custom
 * headers, which the widget's API key can't use here) - no ticket
 * exchange needed, just the same verifySessionToken() requireSession
 * already uses.
 */
export async function agentConsoleRealtimeRoutes(app: FastifyInstance) {
  app.get("/agent-console/ws", { websocket: true }, (socket, request) => {
    void handleConnection(socket, request);
  });
}

async function handleConnection(socket: WebSocket, request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE_NAME];
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    socket.close(4401, "Not authenticated.");
    return;
  }

  const { workspaceId } = session;
  let watchedConversationId: string | null = null;

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

    if (watchedConversationId) {
      unsubscribe(watchedConversationId, socket);
      watchedConversationId = null;
    }

    if (message.type === "conversation:unwatch") {
      return;
    }

    // Never trust the client-supplied id at face value - verify it
    // actually belongs to this workspace before subscribing, same
    // pattern as every ID lookup elsewhere in the Orchestrator.
    const conversationId = message.payload.conversationId;
    const conversation = await withWorkspaceContext(workspaceId, (scopedDb) =>
      getConversationById(scopedDb, workspaceId, conversationId),
    );

    if (!conversation) {
      send(socket, { type: "error", payload: { message: "Conversation not found." } });
      return;
    }

    watchedConversationId = conversationId;
    subscribe(watchedConversationId, socket);
    send(socket, { type: "conversation:watching", payload: { conversationId: watchedConversationId } });
  }

  socket.on("close", () => {
    if (watchedConversationId) {
      unsubscribe(watchedConversationId, socket);
    }
  });
}

function send(socket: WebSocket, event: { type: string; payload: unknown }): void {
  socket.send(JSON.stringify(event));
}
