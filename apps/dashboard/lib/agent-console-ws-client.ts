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
  | { type: "error"; payload: { message: string } };

export class AgentConsoleConnection {
  private ws: WebSocket | null = null;
  private listeners = new Set<(event: AgentConsoleEvent) => void>();

  constructor(private readonly apiUrl: string) {}

  onEvent(listener: (event: AgentConsoleEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): Promise<void> {
    const wsUrl = this.apiUrl.replace(/^http/, "ws");

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}/agent-console/ws`);
      this.ws = ws;

      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("Agent console connection failed.")), { once: true });
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(event.data as string) as AgentConsoleEvent;
        for (const listener of this.listeners) {
          listener(parsed);
        }
      });
    });
  }

  watch(conversationId: string): void {
    this.ws?.send(JSON.stringify({ type: "conversation:watch", payload: { conversationId } }));
  }

  unwatch(): void {
    this.ws?.send(JSON.stringify({ type: "conversation:unwatch", payload: {} }));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
