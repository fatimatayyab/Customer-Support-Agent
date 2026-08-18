import { useEffect, useRef, useState } from "preact/hooks";
import { identifyWorkspace, type IdentifiedWorkspace } from "./api.js";
import { ChatPanel } from "./ChatPanel.js";
import type { WidgetConfig } from "./config.js";
import { getStoredConversationId, getStoredCustomerId, storeConversation } from "./storage.js";
import {
  ChatConnection,
  type ConversationRatingValue,
  type EscalationContactMethod,
  type IncomingEvent,
  type WireMessage,
} from "./ws-client.js";

type IdentifyStatus =
  | { state: "loading" }
  | { state: "ready"; workspace: IdentifiedWorkspace }
  | { state: "error"; message: string };

export function Widget({ config }: { config: WidgetConfig }) {
  const [identify, setIdentify] = useState<IdentifyStatus>({ state: "loading" });
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [messages, setMessages] = useState<WireMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [rating, setRating] = useState<ConversationRatingValue | null>(null);
  const [contactSubmitted, setContactSubmitted] = useState(false);
  const connectionRef = useRef<ChatConnection | null>(null);

  useEffect(() => {
    identifyWorkspace(config)
      .then((workspace) => setIdentify({ state: "ready", workspace }))
      .catch((error: Error) => setIdentify({ state: "error", message: error.message }));
  }, [config]);

  // Connects lazily on first open, not on identify - most site visitors
  // never click the bubble, and every open connection is a cost
  // (server-side memory, and eventually rate-limit budget) the platform
  // shouldn't pay for someone who never engages.
  useEffect(() => {
    if (!open || connectionRef.current) {
      return;
    }

    const connection = new ChatConnection(config);
    connectionRef.current = connection;

    const unsubscribe = connection.onEvent((event: IncomingEvent) => {
      switch (event.type) {
        case "conversation:initiated":
          setConversationId(event.payload.conversation.id);
          setMessages(event.payload.messages);
          storeConversation(event.payload.customer.id, event.payload.conversation.id);
          // Not restored from any prior submission - initiateConversation's
          // response doesn't carry an existing rating (a deliberate v1
          // simplification, see docs/07's CSAT milestone notes), so a
          // resumed conversation always starts looking unrated even if one
          // was already given. Harmless: rateConversation upserts, so
          // rating again just re-confirms the same value.
          setRating(null);
          // Seeded from the server, unlike rating above - the backend
          // already knows whether this conversation has a captured
          // contact (conversation_escalation_contacts), so a reload/new
          // tab/reconnect correctly keeps the offer suppressed instead
          // of asking again just because this component remounted.
          setContactSubmitted(event.payload.hasEscalationContact);
          break;
        case "message:receive":
          setMessages((previous) => [...previous, event.payload]);
          break;
        case "typing:start":
          setTyping(true);
          break;
        case "typing:stop":
          setTyping(false);
          break;
        case "connection:reconnecting":
          setConnected(false);
          setReconnecting(true);
          break;
        case "connection:restored":
          setConnected(true);
          setReconnecting(false);
          break;
      }
    });

    connection
      .connect()
      .then(() => {
        setConnected(true);
        connection.send("conversation:initiate", {
          customerId: getStoredCustomerId() ?? undefined,
          conversationId: getStoredConversationId() ?? undefined,
        });
      })
      .catch(() => setConnected(false));

    return unsubscribe;
  }, [open, config]);

  function handleSend(content: string) {
    if (!conversationId) {
      return;
    }
    connectionRef.current?.send("message:send", { conversationId, content });
  }

  function handleTyping(isTyping: boolean) {
    if (!conversationId) {
      return;
    }
    connectionRef.current?.send(isTyping ? "typing:start" : "typing:stop", { conversationId });
  }

  function handleRate(value: ConversationRatingValue) {
    if (!conversationId) {
      return;
    }
    // Confirmed, not optimistic: the button only reflects the new rating
    // once the PATCH actually succeeds. A failed submit just leaves the
    // buttons as they were - no retry/error UI for a first pass, the
    // customer can simply tap again.
    connectionRef.current?.rateConversation(conversationId, value).then(
      () => setRating(value),
      () => {},
    );
  }

  function handleSubmitContact(contact: { name: string; contactMethod: EscalationContactMethod; contactValue: string }) {
    if (!conversationId) {
      return Promise.reject(new Error("No active conversation."));
    }
    return connectionRef.current!.submitEscalationContact(conversationId, contact).then(() => {
      setContactSubmitted(true);
    });
  }

  if (identify.state !== "ready") {
    // Nothing is known about appearance yet at this point - the built-in
    // defaults (no theming, bottom-right) are exactly what an
    // un-configured workspace always renders anyway, so there's nothing
    // wrong with this branch never reading workspace_widget_settings.
    return (
      <div class="widget-root">
        <div class="bubble">
          {identify.state === "loading" && <span>Loading...</span>}
          {identify.state === "error" && <span class="error">{identify.message}</span>}
        </div>
      </div>
    );
  }

  // identify.state === "ready" is narrowed from here on, so
  // identify.workspace is never null - computed after the early return
  // above, not before, specifically so TypeScript can prove that.
  const settings = identify.workspace;
  const displayName = settings.assistantName ?? settings.name;
  // "position-left" is a class toggle, not a CSS variable - left/right
  // is a discrete choice, not a continuous value.
  const wrapperClass = settings.position === "left" ? "widget-root position-left" : "widget-root";
  const wrapperStyle = settings.primaryColor ? { "--csa-primary-color": settings.primaryColor } : undefined;

  if (!open) {
    return (
      <div class={wrapperClass} style={wrapperStyle}>
        <button type="button" class="bubble bubble-button" onClick={() => setOpen(true)}>
          {settings.avatarUrl && <img class="avatar" src={settings.avatarUrl} alt="" />}
          Chat with {displayName}
        </button>
      </div>
    );
  }

  return (
    <div class={wrapperClass} style={wrapperStyle}>
      <ChatPanel
        workspaceName={displayName}
        avatarUrl={settings.avatarUrl}
        greetingMessage={settings.greetingMessage}
        connected={connected}
        reconnecting={reconnecting}
        messages={messages}
        typing={typing}
        canRate={conversationId !== null}
        rating={rating}
        onRate={handleRate}
        contactSubmitted={contactSubmitted}
        onSubmitContact={handleSubmitContact}
        onSend={handleSend}
        onTyping={handleTyping}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
