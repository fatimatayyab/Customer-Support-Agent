import { useEffect, useRef, useState } from "preact/hooks";
import type { WireMessage } from "./ws-client.js";

const TYPING_STOP_DELAY_MS = 2000;

interface ChatPanelProps {
  workspaceName: string;
  connected: boolean;
  messages: WireMessage[];
  typing: boolean;
  onSend: (content: string) => void;
  onTyping: (isTyping: boolean) => void;
  onClose: () => void;
}

export function ChatPanel({ workspaceName, connected, messages, typing, onSend, onTyping, onClose }: ChatPanelProps) {
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
        <span>{workspaceName}</span>
        <button type="button" class="panel-close" onClick={onClose} aria-label="Close chat">
          &times;
        </button>
      </header>

      <div class="panel-messages" ref={scrollRef}>
        {!connected && <p class="panel-status">Connecting...</p>}
        {messages.map((message) => (
          <div key={message.id} class={`message message-${message.senderType}`}>
            {message.content}
          </div>
        ))}
        {typing && <div class="typing-indicator">...</div>}
      </div>

      <form class="panel-input" onSubmit={handleSubmit}>
        <input
          value={draft}
          onInput={(event) => handleInput((event.target as HTMLInputElement).value)}
          placeholder="Type a message..."
          disabled={!connected}
        />
        <button type="submit" disabled={!connected || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
