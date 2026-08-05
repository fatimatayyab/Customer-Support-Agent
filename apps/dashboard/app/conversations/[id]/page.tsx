"use client";

import type { SessionUser } from "@csa/shared";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "../../../lib/api";
import { AgentConsoleConnection, type WireMessage } from "../../../lib/agent-console-ws-client";

interface ConversationDetail {
  id: string;
  status: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  metadata: { aiSummary?: { text: string; generatedAt: string; provider: string; model: string } };
  createdAt: string;
  updatedAt: string;
}

interface ConversationNote {
  id: string;
  userId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export default function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const conversationId = params.id;

  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<WireMessage[]>([]);
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [connected, setConnected] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const connectionRef = useRef<AgentConsoleConnection | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  async function loadDetail() {
    const data = await apiFetch<{ conversation: ConversationDetail; messages: WireMessage[]; notes: ConversationNote[] }>(
      `/conversations/${conversationId}`,
    );
    if (data) {
      setConversation(data.conversation);
      setMessages(data.messages);
      setNotes(data.notes);
    }
  }

  useEffect(() => {
    apiFetch<{ user: SessionUser }>("/auth/me")
      .then((data) => setSessionUser(data?.user ?? null))
      .catch(() => router.push("/login"));
    loadDetail().catch(() => router.push("/login"));
    apiFetch<{ integrations: { provider: string; status: string }[] }>("/integrations")
      .then((data) => setHubspotConnected(data?.integrations.some((i) => i.provider === "hubspot" && i.status === "connected") ?? false))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    const connection = new AgentConsoleConnection(API_URL);
    connectionRef.current = connection;

    const unsubscribe = connection.onEvent((event) => {
      if (event.type === "message:receive") {
        setMessages((previous) => [...previous, event.payload]);
      } else if (event.type === "typing:start") {
        setTyping(true);
      } else if (event.type === "typing:stop") {
        setTyping(false);
      }
    });

    connection
      .connect()
      .then(() => {
        setConnected(true);
        connection.watch(conversationId);
      })
      .catch(() => setConnected(false));

    return () => {
      unsubscribe();
      connection.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function handleClaim() {
    if (!conversation) {
      return;
    }
    const isReassign = conversation.assignedUserId !== null && conversation.assignedUserId !== sessionUser?.userId;
    if (isReassign) {
      const confirmed = window.confirm(`This conversation is assigned to ${conversation.assignedUserName}. Reassign it to you?`);
      if (!confirmed) {
        return;
      }
    }
    await apiFetch(`/conversations/${conversationId}/claim`, { method: "POST" });
    await loadDetail();
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddNote(event: FormEvent) {
    event.preventDefault();
    const content = noteDraft.trim();
    if (!content) {
      return;
    }
    const result = await apiFetch<{ note: ConversationNote }>(`/conversations/${conversationId}/notes`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    if (result) {
      setNotes((previous) => [...previous, result.note]);
      setNoteDraft("");
    }
  }

  async function handleSuggest() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ suggestion: { reply: string } | null }>(
        `/conversations/${conversationId}/suggest-reply`,
        { method: "POST" },
      );
      if (result?.suggestion) {
        setDraft(result.suggestion.reply);
      } else {
        setError("No relevant knowledge to base a suggestion on.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate a suggestion.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSummarize() {
    setBusy(true);
    try {
      await apiFetch(`/conversations/${conversationId}/summarize`, { method: "POST" });
      await loadDetail();
    } finally {
      setBusy(false);
    }
  }

  async function handleContactLookup(event: FormEvent) {
    event.preventDefault();
    const email = contactEmail.trim();
    if (!email) {
      return;
    }
    setContactBusy(true);
    setContactError(null);
    try {
      await apiFetch(`/conversations/${conversationId}/actions/contact-lookup`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setContactEmail("");
      await loadDetail();
    } catch (err) {
      setContactError(err instanceof ApiError ? err.message : "Contact lookup failed.");
    } finally {
      setContactBusy(false);
    }
  }

  async function handleStatusChange(status: "resolved" | "closed" | "open") {
    await apiFetch(`/conversations/${conversationId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await loadDetail();
  }

  if (!conversation || !sessionUser) {
    return null;
  }

  const isMine = conversation.assignedUserId === sessionUser.userId;
  const claimLabel = !conversation.assignedUserId ? "Claim" : isMine ? null : "Reassign to me";

  return (
    <main className="mx-auto flex max-w-5xl gap-6 px-4 py-10">
      <div className="flex-1">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Link href="/conversations" className="text-sm text-slate-500 underline">
              Back to queue
            </Link>
            <h1 className="mt-1 text-lg font-semibold">Conversation {conversation.id.slice(0, 8)}</h1>
          </div>
          <div className="flex items-center gap-2">
            {claimLabel && (
              <button onClick={handleClaim} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">
                {claimLabel}
              </button>
            )}
            {isMine && <span className="text-sm text-slate-500">Assigned to you</span>}
            <select
              value={conversation.status}
              onChange={(event) => handleStatusChange(event.target.value as "resolved" | "closed" | "open")}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {!["open", "resolved", "closed"].includes(conversation.status) && (
                <option value={conversation.status} disabled>
                  {conversation.status}
                </option>
              )}
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          {conversation.metadata.aiSummary ? (
            <p>{conversation.metadata.aiSummary.text}</p>
          ) : (
            <p className="text-slate-500">No summary yet.</p>
          )}
          <button onClick={handleSummarize} disabled={busy} className="mt-2 text-xs text-slate-500 underline">
            {conversation.metadata.aiSummary ? "Regenerate summary" : "Summarize"}
          </button>
        </div>

        <div ref={scrollRef} className="mb-3 h-96 overflow-y-auto rounded-md border border-slate-200 p-3">
          {!connected && <p className="text-sm text-slate-500">Connecting...</p>}
          {messages.map((message) => (
            <div key={message.id} className="mb-2 text-sm">
              <span className="font-medium">{message.senderName ?? message.senderType}: </span>
              <span>{message.content}</span>
            </div>
          ))}
          {typing && <div className="text-sm text-slate-400">...</div>}
        </div>

        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

        <form onSubmit={handleSend} className="flex gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a reply..."
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handleSuggest}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          >
            Suggest
          </button>
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>

      <aside className="w-64 shrink-0">
        {hubspotConnected && (
          <div className="mb-4">
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">CRM</h2>
            <form onSubmit={handleContactLookup} className="flex flex-col gap-2">
              <input
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder="Customer email"
                type="email"
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              {contactError && <p className="text-xs text-red-600">{contactError}</p>}
              <button
                type="submit"
                disabled={contactBusy || !contactEmail.trim()}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {contactBusy ? "Looking up..." : "Check contact"}
              </button>
            </form>
          </div>
        )}

        <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">Internal notes</h2>
        <ul className="mb-3 space-y-2">
          {notes.length === 0 && <li className="text-sm text-slate-500">No notes yet.</li>}
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm">
              <div className="mb-1 text-xs font-medium text-amber-800">{note.authorName}</div>
              {note.content}
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddNote} className="flex flex-col gap-2">
          <textarea
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="Add a note (not visible to the customer)..."
            rows={3}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
            Add note
          </button>
        </form>
      </aside>
    </main>
  );
}
