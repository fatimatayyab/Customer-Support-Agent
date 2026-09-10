import { useEffect, useRef, useState } from "preact/hooks";
import type { ConversationRatingValue, EscalationContactMethod, WireAttachment, WireMessage } from "./ws-client.js";

const TYPING_STOP_DELAY_MS = 2000;

// A file selected in the composer but not yet sent. `status` tracks
// whether it has already been uploaded (its id is then reused on retry
// rather than re-uploaded); `key` is a local React key, unrelated to any
// server id.
export interface PendingAttachment {
  key: string;
  file: File;
  status: "pending" | "uploaded";
  id?: string;
}

interface ChatPanelProps {
  workspaceName: string;
  avatarUrl: string | null;
  greetingMessage: string | null;
  connected: boolean;
  reconnecting: boolean;
  // True once conversation:initiated has come back (conversationId is
  // set) - distinct from `connected`, which only reflects the WebSocket
  // socket itself opening. There's a real gap between the two: the
  // socket can be open for a moment before the server's initiate
  // response (and any resumed history) actually arrives, during which
  // the panel would otherwise show only the static greeting with no
  // indication anything is still loading.
  conversationInitiated: boolean;
  messages: WireMessage[];
  typing: boolean;
  canRate: boolean;
  rating: ConversationRatingValue | null;
  onRate: (rating: ConversationRatingValue) => void;
  contactSubmitted: boolean;
  onSubmitContact: (contact: { name: string; contactMethod: EscalationContactMethod; contactValue: string }) => Promise<void>;
  onSend: (content: string) => void;
  onTyping: (isTyping: boolean) => void;
  onClose: () => void;
  pendingAttachments: PendingAttachment[];
  onSelectFiles: (files: File[]) => void;
  onRemoveAttachment: (key: string) => void;
  sendError: string | null;
  uploading: boolean;
  getAttachmentDownloadUrl: (attachmentId: string) => Promise<string>;
}

// Inline, under the specific message that triggered escalation - not a
// persistent top-level button. Offered, never forced: "No thanks"
// dismisses just that one offer (a later escalation still offers again),
// and the customer can keep chatting either way.
//
// `contactSubmitted` (lifted to Widget.tsx) suppresses *new*, never-opened
// offers once a contact has been submitted anywhere in this conversation -
// but it's checked after `done`, not before: the instance that was itself
// just submitted flips contactSubmitted to true via the same promise its
// own onSubmit chains off, so checking contactSubmitted first would
// unmount this component before its own "done" state ever got a chance
// to render, replacing the confirmation with nothing.
function EscalationContactOffer({
  contactSubmitted,
  onSubmit,
}: {
  contactSubmitted: boolean;
  onSubmit: (contact: { name: string; contactMethod: EscalationContactMethod; contactValue: string }) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [name, setName] = useState("");
  const [contactMethod, setContactMethod] = useState<EscalationContactMethod>("email");
  const [contactValue, setContactValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    // Deliberately short, not a repeat of the CONTACT_RECEIVED_MESSAGE
    // chat bubble arriving right below it - that message already carries
    // the full "a team member will reach out" text.
    return <p class="escalation-offer escalation-offer-done">✓ Details sent</p>;
  }

  if (dismissed || contactSubmitted) {
    return null;
  }

  if (!expanded) {
    return (
      <div class="escalation-offer">
        <span>Would you like to leave your contact details so a team member can follow up?</span>
        <div class="escalation-offer-actions">
          <button type="button" onClick={() => setExpanded(true)}>
            Yes, please
          </button>
          <button type="button" class="escalation-offer-dismiss" onClick={() => setDismissed(true)}>
            No thanks
          </button>
        </div>
      </div>
    );
  }

  function handleSubmit(event: Event) {
    event.preventDefault();
    if (!name.trim() || !contactValue.trim()) {
      return;
    }
    setSubmitting(true);
    setError(null);
    onSubmit({ name: name.trim(), contactMethod, contactValue: contactValue.trim() }).then(
      () => setDone(true),
      () => {
        setSubmitting(false);
        setError("Couldn't submit your details - please try again.");
      },
    );
  }

  return (
    <form class="escalation-offer escalation-offer-form" onSubmit={handleSubmit}>
      <input value={name} onInput={(event) => setName((event.target as HTMLInputElement).value)} placeholder="Your name" />
      <div class="escalation-offer-contact-row">
        <select
          value={contactMethod}
          onChange={(event) => setContactMethod((event.target as HTMLSelectElement).value as EscalationContactMethod)}
        >
          <option value="email">Email</option>
          <option value="phone">Phone</option>
        </select>
        <input
          value={contactValue}
          onInput={(event) => setContactValue((event.target as HTMLInputElement).value)}
          placeholder={contactMethod === "email" ? "you@example.com" : "+1 555 0100"}
          type={contactMethod === "email" ? "email" : "tel"}
        />
      </div>
      {error && <span class="escalation-offer-error">{error}</span>}
      <div class="escalation-offer-actions">
        <button type="submit" disabled={submitting || !name.trim() || !contactValue.trim()}>
          {submitting ? "Sending..." : "Submit"}
        </button>
        <button type="button" class="escalation-offer-dismiss" onClick={() => setDismissed(true)} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// A not-yet-sent file in the composer: image thumbnails use an object
// URL created locally (no network), non-images show a compact file chip.
// The object URL is revoked on unmount so a long chat session doesn't
// leak blobs.
function PendingAttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
  const isImage = attachment.file.type.startsWith("image/");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) {
      return;
    }
    const url = URL.createObjectURL(attachment.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment.file, isImage]);

  return (
    <div class="attachment-chip">
      {previewUrl ? (
        <img class="attachment-chip-thumb" src={previewUrl} alt="" />
      ) : (
        <span class="attachment-chip-icon" aria-hidden="true">
          📄
        </span>
      )}
      <span class="attachment-chip-meta">
        <span class="attachment-chip-name">{attachment.file.name}</span>
        <span class="attachment-chip-size">{formatFileSize(attachment.file.size)}</span>
      </span>
      <button type="button" class="attachment-chip-remove" onClick={onRemove} aria-label="Remove file">
        ×
      </button>
    </div>
  );
}

// A sent message's attachment. Images load through a freshly minted
// download ticket (browsers can't send the widget's X-API-Key header on
// an <img> request, so the ticket rides in the URL - see
// ws-client.ts's createAttachmentDownloadUrl). Non-images render as a
// clickable file card that downloads the original.
function MessageAttachment({
  attachment,
  getDownloadUrl,
}: {
  attachment: WireAttachment;
  getDownloadUrl: (attachmentId: string) => Promise<string>;
}) {
  const isImage = attachment.mimeType.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDownloadUrl(attachment.id)
      .then((resolved) => {
        if (!cancelled) {
          setUrl(resolved);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, getDownloadUrl]);

  if (isImage) {
    return (
      <a href={url ?? "#"} target="_blank" rel="noopener noreferrer" class="message-attachment-image">
        {url ? <img src={url} alt={attachment.filename} /> : <span class="message-attachment-loading">Loading image...</span>}
      </a>
    );
  }

  return (
    <a href={url ?? "#"} target="_blank" rel="noopener noreferrer" class="message-attachment-file">
      <span class="attachment-chip-icon" aria-hidden="true">
        📄
      </span>
      <span class="message-attachment-file-name">{attachment.filename}</span>
      <span class="message-attachment-file-size">{formatFileSize(attachment.size)}</span>
    </a>
  );
}

export function ChatPanel({
  workspaceName,
  avatarUrl,
  greetingMessage,
  connected,
  reconnecting,
  conversationInitiated,
  messages,
  typing,
  canRate,
  rating,
  onRate,
  contactSubmitted,
  onSubmitContact,
  onSend,
  onTyping,
  onClose,
  pendingAttachments,
  onSelectFiles,
  onRemoveAttachment,
  sendError,
  uploading,
  getAttachmentDownloadUrl,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const typingTimeoutRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, typing]);

  function handleInput(value: string) {
    setDraft(value);
    onTyping(true);
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => onTyping(false), TYPING_STOP_DELAY_MS);
  }

  function handleSubmit(event: Event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content && pendingAttachments.length === 0) {
      return;
    }
    onSend(content);
    setDraft("");
    onTyping(false);
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
    }
  }

  function handleFileInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) {
      onSelectFiles(files);
    }
  }

  const composerLocked = !connected || !conversationInitiated || uploading;

  return (
    <div class="panel">
      <header class="panel-header">
        <span class="panel-header-title">
          {avatarUrl && <img class="avatar" src={avatarUrl} alt="" />}
          <span>{workspaceName}</span>
        </span>
        <button type="button" class="panel-close" onClick={onClose} aria-label="Close chat">
          &times;
        </button>
      </header>

      <div class="panel-messages" ref={scrollRef}>
        {/* Mutually exclusive with the connected/reconnecting states below
            it - this only ever shows in the brief window after the socket
            opens but before conversation:initiated (with any resumed
            history) has arrived. Once initiated, conversationInitiated
            flips to true and this line disappears on its own, the same
            way every other status line here already does - no separate
            timeout/cleanup needed. */}
        {!connected ? (
          <p class="panel-status">{reconnecting ? "Reconnecting..." : "Connecting..."}</p>
        ) : (
          !conversationInitiated && <p class="panel-status">Loading conversation...</p>
        )}
        {greetingMessage && <div class="message message-ai">{greetingMessage}</div>}
        {messages.map((message) => (
          <div key={message.id} class="message-wrap">
            <div class={`message message-${message.senderType}`}>
              {message.content && <div class="message-text">{message.content}</div>}
              {message.attachments && message.attachments.length > 0 && (
                <div class="message-attachments">
                  {message.attachments.map((attachment) => (
                    <MessageAttachment
                      key={attachment.id}
                      attachment={attachment}
                      getDownloadUrl={getAttachmentDownloadUrl}
                    />
                  ))}
                </div>
              )}
            </div>
            {message.metadata?.escalated && (
              <EscalationContactOffer contactSubmitted={contactSubmitted} onSubmit={onSubmitContact} />
            )}
          </div>
        ))}
        {typing && <div class="typing-indicator">...</div>}
      </div>

      {canRate && (
        <div class="panel-rating">
          {rating ? (
            <span>Thanks for your feedback!</span>
          ) : (
            <>
              <span>Rate this chat:</span>
              <button
                type="button"
                class="rating-button"
                onClick={() => onRate("up")}
                disabled={!connected}
                aria-label="Good"
              >
                👍
              </button>
              <button
                type="button"
                class="rating-button"
                onClick={() => onRate("down")}
                disabled={!connected}
                aria-label="Not good"
              >
                👎
              </button>
            </>
          )}
        </div>
      )}

      {pendingAttachments.length > 0 && (
        <div class="attachment-preview-row">
          {pendingAttachments.map((attachment) => (
            <PendingAttachmentChip
              key={attachment.key}
              attachment={attachment}
              onRemove={() => onRemoveAttachment(attachment.key)}
            />
          ))}
        </div>
      )}
      {sendError && <div class="panel-send-error">{sendError}</div>}

      <form class="panel-input" onSubmit={handleSubmit}>
        <label class="panel-attach" title="Attach a file">
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.doc,.docx"
            hidden
            onChange={handleFileInput}
            disabled={composerLocked || pendingAttachments.length >= 6}
          />
          📎
        </label>
        <input
          value={draft}
          onInput={(event) => handleInput((event.target as HTMLInputElement).value)}
          placeholder="Type a message..."
          disabled={composerLocked}
        />
        <button
          type="submit"
          disabled={composerLocked || (!draft.trim() && pendingAttachments.length === 0)}
        >
          {uploading ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
}