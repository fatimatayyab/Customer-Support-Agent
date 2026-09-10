import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { identifyWorkspace, type IdentifiedWorkspace } from "./api.js";
import { ChatPanel, type PendingAttachment } from "./ChatPanel.js";
import type { WidgetConfig } from "./config.js";
import { getStoredConversationId, getStoredCustomerId, storeConversation } from "./storage.js";
import {
  ChatConnection,
  type ConversationRatingValue,
  type EscalationContactMethod,
  type IncomingEvent,
  type WireMessage,
} from "./ws-client.js";

// Client-side mirror of the server's own limits (message-attachment.config.ts).
// Convenience only - the server re-validates every file; a mismatch here
// just means the customer gets a friendlier, earlier error.
const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const MAX_PENDING_ATTACHMENTS = 6;

let nextAttachmentKey = 0;

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
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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
    if (!conversationId || !connectionRef.current) {
      return;
    }
    const connection = connectionRef.current;

    // Text-only path unchanged - no uploads to orchestrate, send straight
    // over the socket exactly as before.
    if (pendingAttachments.length === 0) {
      connection.send("message:send", {
        conversationId,
        content,
        pageUrl: window.location.href,
        pageTitle: document.title,
      });
      return;
    }

    // Attachment path: upload any not-yet-uploaded files first, then send
    // one message claiming every id. A file already uploaded (e.g. a retry
    // after a send failure) is reused, never uploaded twice.
    setUploading(true);
    setSendError(null);
    const toUpload = pendingAttachments.filter((attachment) => attachment.status !== "uploaded");
    Promise.all(
      toUpload.map((attachment) =>
        connection
          .uploadAttachment(conversationId!, attachment.file)
          .then((metadata) => ({ key: attachment.key, metadata })),
      ),
    )
      .then((results) => {
        const byKey = new Map(results.map((result) => [result.key, result.metadata]));
        const withIds = pendingAttachments.map((attachment) =>
          byKey.has(attachment.key)
            ? { ...attachment, status: "uploaded" as const, id: byKey.get(attachment.key)!.id }
            : attachment,
        );
        connection.send("message:send", {
          conversationId,
          content,
          attachmentIds: withIds.map((attachment) => attachment.id!).filter(Boolean),
          pageUrl: window.location.href,
          pageTitle: document.title,
        });
        setPendingAttachments([]);
        setUploading(false);
      })
      .catch(() => {
        setUploading(false);
        setSendError("Couldn't upload one of the files - please try again.");
      });
  }

  function handleSelectFiles(files: File[]) {
    const rejects: string[] = [];
    const additions: PendingAttachment[] = [];
    for (const file of files) {
      const mimeType = file.type.toLowerCase();
      if (!ALLOWED_ATTACHMENT_TYPES.has(mimeType)) {
        rejects.push(`"${file.name}" isn't a supported file type`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        rejects.push(`"${file.name}" is larger than 5MB`);
        continue;
      }
      if (pendingAttachments.length + additions.length >= MAX_PENDING_ATTACHMENTS) {
        rejects.push(`You can attach up to ${MAX_PENDING_ATTACHMENTS} files`);
        break;
      }
      additions.push({ key: `attachment-${nextAttachmentKey++}`, file, status: "pending" });
    }
    if (additions.length > 0) {
      setPendingAttachments((previous) => [...previous, ...additions]);
    }
    if (rejects.length > 0) {
      setSendError(rejects.join(" · "));
    }
  }

  function handleRemoveAttachment(key: string) {
    setPendingAttachments((previous) => previous.filter((attachment) => attachment.key !== key));
  }

  // Stable across renders so MessageAttachment's mint-once effect never
  // re-fires because the callback identity changed. The connection is
  // guaranteed present whenever messages exist to render.
  const getAttachmentDownloadUrl = useCallback(
    (attachmentId: string) => connectionRef.current!.createAttachmentDownloadUrl(attachmentId),
    [],
  );

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
        conversationInitiated={conversationId !== null}
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
        pendingAttachments={pendingAttachments}
        onSelectFiles={handleSelectFiles}
        onRemoveAttachment={handleRemoveAttachment}
        sendError={sendError}
        uploading={uploading}
        getAttachmentDownloadUrl={getAttachmentDownloadUrl}
      />
    </div>
  );
}
