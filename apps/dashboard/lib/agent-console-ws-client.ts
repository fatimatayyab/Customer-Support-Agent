// Deliberately separate from the widget's ws-client.ts (apps/widget),
// not shared code - the auth (session cookie vs API-key ticket) and
// subscription model (watch one existing conversation vs initiate a
// new one) differ enough that forcing a shared abstraction now would
// likely be the wrong one. Read-only: this connection only ever
// receives broadcasts. Sending a reply/claiming/notes all go through
// plain REST (lib/api.ts), same as every other dashboard action.

export interface WireMessage {
  id: string;
  conversationId: string;
  senderType: "customer" | "agent" | "system" | "ai";
  senderUserId: string | null;
  senderName: string | null;
  content: string;
  createdAt: string;
}

export type AgentConsoleEvent =
  | { type: "conversation:watching"; payload: { conversationId: string } }
  | { type: "message:receive"; payload: WireMessage }
  | { type: "typing:start"; payload: Record<string, never> }
  | { type: "typing:stop"; payload: Record<string, never> }
  | { type: "error"; payload: { message: string } }
  // Not sent by the server - synthesized locally, same reasoning as
  // ws-client.ts's identical pair of events.
  | { type: "connection:reconnecting"; payload: Record<string, never> }
  | { type: "connection:restored"; payload: Record<string, never> };

const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const JITTER_RATIO = 0.2;

// Same 1s/2s/4s/8s/16s/30s-capped schedule as the widget's client -
// see ws-client.ts's identical function for the full reasoning. Kept
// as an independent copy, not a shared import, for the same reason
// this whole class is independent of the widget's.
function reconnectDelayMs(attempt: number): number {
  const base = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
  const jitter = base * JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

export class AgentConsoleConnection {
  private ws: WebSocket | null = null;
  private listeners = new Set<(event: AgentConsoleEvent) => void>();
  private closedDeliberately = false;
  private reconnecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Same reasoning as ws-client.ts's identical flag: an initial
  // connection failure must reject connect() and stop there (the page's
  // own .catch() already handles that), not silently start a background
  // retry loop the caller doesn't know about.
  private hasOpenedOnce = false;
  // Which conversation to automatically re-watch after a reconnect -
  // tracked here rather than requiring the page to re-call watch()
  // itself, so reconnection stays entirely self-contained.
  private watchedConversationId: string | null = null;

  constructor(private readonly apiUrl: string) {}

  onEvent(listener: (event: AgentConsoleEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): Promise<void> {
    this.closedDeliberately = false;
    return this.openSocket();
  }

  private openSocket(): Promise<void> {
    const wsUrl = this.apiUrl.replace(/^http/, "ws");

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}/agent-console/ws`);
      this.ws = ws;

      ws.addEventListener(
        "open",
        () => {
          this.hasOpenedOnce = true;
          this.reconnectAttempt = 0;
          if (this.reconnecting) {
            this.reconnecting = false;
            if (this.watchedConversationId) {
              this.watch(this.watchedConversationId);
            }
            this.emit({ type: "connection:restored", payload: {} });
          }
          resolve();
        },
        { once: true },
      );
      ws.addEventListener("error", () => reject(new Error("Agent console connection failed.")), { once: true });
      ws.addEventListener("message", (event) => {
        this.emit(JSON.parse(event.data as string) as AgentConsoleEvent);
      });
      ws.addEventListener("close", () => {
        if (this.closedDeliberately || !this.hasOpenedOnce) {
          return;
        }
        this.scheduleReconnect();
      });
    });
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

  private emit(event: AgentConsoleEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  watch(conversationId: string): void {
    this.watchedConversationId = conversationId;
    this.ws?.send(JSON.stringify({ type: "conversation:watch", payload: { conversationId } }));
  }

  unwatch(): void {
    this.watchedConversationId = null;
    this.ws?.send(JSON.stringify({ type: "conversation:unwatch", payload: {} }));
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
