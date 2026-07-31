import type { WebSocket } from "ws";

/**
 * In-process only: a Map from conversationId to the set of open
 * WebSocket connections currently subscribed to it. This is a
 * deliberate simplification, not an oversight - there is one API
 * instance and no infrastructure to run more yet. When the API scales
 * horizontally, this needs to become Redis pub/sub (SUBSCRIBE per
 * conversationId, PUBLISH on broadcast) instead of an in-memory Map.
 * subscribe/unsubscribe/publishToConversation are the only surface
 * callers use, so that swap shouldn't touch anything outside this file.
 */
const subscribers = new Map<string, Set<WebSocket>>();

export function subscribe(conversationId: string, socket: WebSocket): void {
  let sockets = subscribers.get(conversationId);
  if (!sockets) {
    sockets = new Set();
    subscribers.set(conversationId, sockets);
  }
  sockets.add(socket);
}

export function unsubscribe(conversationId: string, socket: WebSocket): void {
  const sockets = subscribers.get(conversationId);
  if (!sockets) {
    return;
  }
  sockets.delete(socket);
  if (sockets.size === 0) {
    subscribers.delete(conversationId);
  }
}

export interface ConversationEvent {
  type: string;
  payload: unknown;
}

export function publishToConversation(conversationId: string, event: ConversationEvent, exclude?: WebSocket): void {
  const sockets = subscribers.get(conversationId);
  if (!sockets) {
    return;
  }

  const data = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket === exclude) {
      continue;
    }
    if (socket.readyState === socket.OPEN) {
      socket.send(data);
    }
  }
}
