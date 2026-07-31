import type { WidgetConfig } from "./config.js";

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

export type IncomingEvent =
  | { type: "conversation:initiated"; payload: { customer: WireCustomer; conversation: WireConversation; messages: WireMessage[] } }
  | { type: "message:receive"; payload: WireMessage }
  | { type: "typing:start"; payload: Record<string, never> }
  | { type: "typing:stop"; payload: Record<string, never> }
  | { type: "error"; payload: { message: string } };

/**
 * Owns the two-step handshake (POST /widget/session for a short-lived
 * ticket, then the actual WS connection) so nothing above this layer
 * needs to know that browsers can't set headers on a WS upgrade.
 */
export class ChatConnection {
  private ws: WebSocket | null = null;
  private listeners = new Set<(event: IncomingEvent) => void>();

  constructor(private readonly config: WidgetConfig) {}

  onEvent(listener: (event: IncomingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<void> {
    const response = await fetch(`${this.config.apiUrl}/widget/session`, {
      method: "POST",
      headers: { "X-API-Key": this.config.apiKey },
    });
    if (!response.ok) {
      throw new Error("Could not start a chat session.");
    }
    const { ticket } = (await response.json()) as { ticket: string };

    const wsUrl = this.config.apiUrl.replace(/^http/, "ws");

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}/widget/ws?ticket=${encodeURIComponent(ticket)}`);
      this.ws = ws;

      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("Chat connection failed.")), { once: true });
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(event.data as string) as IncomingEvent;
        for (const listener of this.listeners) {
          listener(parsed);
        }
      });
    });
  }

  send(type: string, payload: unknown): void {
    this.ws?.send(JSON.stringify({ type, payload }));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
