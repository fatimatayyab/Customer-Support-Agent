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
          // Not restored from any prior submission either, same
          // deliberate v1 simplification as rating above - a resumed
          // conversation with an already-submitted contact just offers
          // the form again if a later escalation happens; resubmitting
          // is harmless since the server upserts.
          setContactSubmitted(false);
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
    return (
      <div class="bubble">
        {identify.state === "loading" && <span>Loading...</span>}
        {identify.state === "error" && <span class="error">{identify.message}</span>}
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" class="bubble bubble-button" onClick={() => setOpen(true)}>
        Chat with {identify.workspace.name}
      </button>
    );
  }

  return (
    <ChatPanel
      workspaceName={identify.workspace.name}
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
  );
}
