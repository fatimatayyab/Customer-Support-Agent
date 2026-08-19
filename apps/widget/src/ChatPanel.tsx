import { useEffect, useRef, useState } from "preact/hooks";
import type { ConversationRatingValue, EscalationContactMethod, WireMessage } from "./ws-client.js";

const TYPING_STOP_DELAY_MS = 2000;

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
    if (!content) {
      return;
    }
    onSend(content);
    setDraft("");
    onTyping(false);
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
    }
  }

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
          <div key={message.id}>
            <div class={`message message-${message.senderType}`}>{message.content}</div>
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

      <form class="panel-input" onSubmit={handleSubmit}>
        <input
          value={draft}
          onInput={(event) => handleInput((event.target as HTMLInputElement).value)}
          placeholder="Type a message..."
          disabled={!connected || !conversationInitiated}
        />
        <button type="submit" disabled={!connected || !conversationInitiated || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
