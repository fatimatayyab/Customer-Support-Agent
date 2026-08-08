import type { WidgetConfig } from "./config.js";
import { getStoredConversationId, getStoredCustomerId } from "./storage.js";

export interface WireMessage {
  id: string;
  conversationId: string;
  senderType: "customer" | "agent" | "system" | "ai";
  content: string;
  createdAt: string;
}

export interface WireConversation {
  id: string;
  status: string;
}

export interface WireCustomer {
  id: string;
}

export type ConversationRatingValue = "up" | "down";

export type IncomingEvent =
  | { type: "conversation:initiated"; payload: { customer: WireCustomer; conversation: WireConversation; messages: WireMessage[] } }
  | { type: "message:receive"; payload: WireMessage }
  | { type: "typing:start"; payload: Record<string, never> }
  | { type: "typing:stop"; payload: Record<string, never> }
  | { type: "error"; payload: { message: string } }
  // Not sent by the server - synthesized locally so the UI layer can
  // react to connection loss/recovery through the same onEvent stream
  // it already listens on, without a second callback mechanism.
  | { type: "connection:reconnecting"; payload: Record<string, never> }
  | { type: "connection:restored"; payload: Record<string, never> };

const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const JITTER_RATIO = 0.2;

// 1s, 2s, 4s, 8s, 16s, then capped at 30s - retries indefinitely at that
// steady state rather than giving up, with +/-20% jitter so a fleet of
// widgets reconnecting after the same API restart doesn't hit it in
// lockstep.
function reconnectDelayMs(attempt: number): number {
  const base = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
  const jitter = base * JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

/**
 * Owns the two-step handshake (POST /widget/session for a short-lived
 * ticket, then the actual WS connection) so nothing above this layer
 * needs to know that browsers can't set headers on a WS upgrade. Also
 * owns reconnection: an unexpected close (API restart, network blip)
 * re-runs the full handshake - the old ticket is single-use and can't
 * simply be reused - and, once back open, re-sends conversation:initiate
 * with the same persisted ids storage.ts already tracks, resuming the
 * same conversation exactly as a manual page reload already would.
 */
export class ChatConnection {
  private ws: WebSocket | null = null;
  private listeners = new Set<(event: IncomingEvent) => void>();
  private closedDeliberately = false;
  private reconnecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Guards against the very first connection attempt's own failure
  // triggering a background reconnect loop: browsers fire "close" right
  // after "error" even on an attempt that never opened, and connect()'s
  // caller (Widget.tsx) already has its own reject/catch for that case -
  // reconnection only makes sense once we've been open at least once.
  private hasOpenedOnce = false;

  constructor(private readonly config: WidgetConfig) {}

  onEvent(listener: (event: IncomingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<void> {
    this.closedDeliberately = false;
    return this.openSocket();
  }

  private openSocket(): Promise<void> {
    return this.startHandshake().then(
      (ticket) =>
        new Promise((resolve, reject) => {
          const wsUrl = this.config.apiUrl.replace(/^http/, "ws");
          const ws = new WebSocket(`${wsUrl}/widget/ws?ticket=${encodeURIComponent(ticket)}`);
          this.ws = ws;

          ws.addEventListener(
            "open",
            () => {
              this.hasOpenedOnce = true;
              this.reconnectAttempt = 0;
              if (this.reconnecting) {
                this.reconnecting = false;
                this.send("conversation:initiate", {
                  customerId: getStoredCustomerId() ?? undefined,
                  conversationId: getStoredConversationId() ?? undefined,
                });
                this.emit({ type: "connection:restored", payload: {} });
              }
              resolve();
            },
            { once: true },
          );
          ws.addEventListener("error", () => reject(new Error("Chat connection failed.")), { once: true });
          ws.addEventListener("message", (event) => {
            this.emit(JSON.parse(event.data as string) as IncomingEvent);
          });
          ws.addEventListener("close", () => {
            if (this.closedDeliberately || !this.hasOpenedOnce) {
              return;
            }
            this.scheduleReconnect();
          });
        }),
    );
  }

  private async startHandshake(): Promise<string> {
    const response = await fetch(`${this.config.apiUrl}/widget/session`, {
      method: "POST",
      headers: { "X-API-Key": this.config.apiKey },
    });
    if (!response.ok) {
      throw new Error("Could not start a chat session.");
    }
    const { ticket } = (await response.json()) as { ticket: string };
    return ticket;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    if (!this.reconnecting) {
      this.reconnecting = true;
      this.emit({ type: "connection:reconnecting", payload: {} });
    }
    const delay = reconnectDelayMs(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private emit(event: IncomingEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  send(type: string, payload: unknown): void {
    this.ws?.send(JSON.stringify({ type, payload }));
  }

  // A plain REST call, not a WS message - a rating isn't a live event
  // anything else needs to react to in real time, so it doesn't need the
  // socket at all (same reasoning startHandshake() above already uses
  // fetch instead of the socket for the ticket exchange). Upsert on the
  // server side (conversation-rating.repository.ts) makes this safely
  // callable more than once for the same conversation.
  async rateConversation(conversationId: string, rating: ConversationRatingValue): Promise<void> {
    const response = await fetch(`${this.config.apiUrl}/widget/conversations/${conversationId}/rating`, {
      method: "PATCH",
      headers: { "X-API-Key": this.config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    });
    if (!response.ok) {
      throw new Error("Could not submit rating.");
    }
  }

  close(): void {
    this.closedDeliberately = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
