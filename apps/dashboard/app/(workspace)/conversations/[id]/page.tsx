"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/error-state";
import { Input, Select, Textarea } from "@/components/ui/field";
import { PageSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session-context";
import { ApiError, apiFetch } from "@/lib/api";
import { AgentConsoleConnection, type WireMessage } from "@/lib/agent-console-ws-client";

interface ConversationDetail {
  id: string;
  status: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  // metadata.escalation (the single "current reason" snapshot) is no
  // longer read here - the full escalation history (below) replaced it,
  // see conversation_escalations. Still written by escalateConversation
  // for other readers (the queue badge, analytics) that only need "what
  // is this conversation escalated for right now."
  metadata: {
    aiSummary?: { text: string; generatedAt: string; provider: string; model: string };
  };
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

interface EscalationContact {
  id: string;
  name: string;
  contactMethod: "email" | "phone";
  contactValue: string;
}

interface EscalationEvent {
  id: string;
  reason: string;
  detail: string;
  escalatedAt: string;
}

const ESCALATION_REASON_LABELS: Record<string, string> = {
  no_relevant_knowledge: "No matching knowledge",
  low_confidence: "Low AI confidence",
  ai_requested_escalation: "AI requested a human",
  ai_provider_error: "AI provider error",
  customer_requested_human: "Customer asked for a human",
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

// Mirrors the widget's own message convention (apps/widget/src/widget.css's
// .message-customer / .message-agent,.message-ai,.message-system) but
// mirrored: from an agent's own console, the workspace's own replies -
// agent, AI, and "system" (the hardcoded fallback/confirmation text the
// Orchestrator sends when there's no relevant knowledge or a contact
// was just captured - always customer-facing, never an internal notice,
// see support-orchestrator.ts's insertMessage calls) - are all "our
// side" (right-aligned). Only the customer is the other party
// (left-aligned). Grouping system with agent/ai here, not as a separate
// plain-text notice, matches exactly what the customer themselves saw.
function isOutboundSender(senderType: WireMessage["senderType"]): boolean {
  return senderType !== "customer";
}

const SENDER_LABELS: Record<WireMessage["senderType"], string> = {
  customer: "Customer",
  agent: "Agent",
  ai: "AI",
  system: "AI",
};

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function MessageBubble({ message }: { message: WireMessage }) {
  const outbound = isOutboundSender(message.senderType);
  const isAutomated = message.senderType === "ai" || message.senderType === "system";
  const label = message.senderName ?? SENDER_LABELS[message.senderType];

  return (
    <div className={cn("flex flex-col gap-0.5", outbound ? "items-end" : "items-start")}>
      <span className="flex items-center gap-1 px-1 text-xs font-medium text-slate-500">
        {isAutomated && <Bot className="h-3 w-3" />}
        {label}
      </span>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words",
          outbound
            ? cn("rounded-br-sm text-on-fill", isAutomated ? "bg-fill-muted" : "bg-brand")
            : "rounded-bl-sm bg-slate-100 text-slate-900",
        )}
      >
        {message.content}
      </div>
      <span className="px-1 text-[11px] text-slate-400">{formatMessageTime(message.createdAt)}</span>
    </div>
  );
}

export default function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const conversationId = params.id;
  const { user: sessionUser } = useSession();

  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<WireMessage[]>([]);
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [escalationContact, setEscalationContact] = useState<EscalationContact | null>(null);
  const [escalations, setEscalations] = useState<EscalationEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [reassignConfirmOpen, setReassignConfirmOpen] = useState(false);
  const connectionRef = useRef<AgentConsoleConnection | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  async function loadDetail() {
    const data = await apiFetch<{
      conversation: ConversationDetail;
      messages: WireMessage[];
      notes: ConversationNote[];
      escalationContact: EscalationContact | null;
      escalations: EscalationEvent[];
    }>(`/conversations/${conversationId}`);
    if (data) {
      setConversation(data.conversation);
      setMessages(data.messages);
      setNotes(data.notes);
      setEscalationContact(data.escalationContact);
      setEscalations(data.escalations);
    }
  }

  useEffect(() => {
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
      } else if (event.type === "connection:reconnecting") {
        setConnected(false);
        setReconnecting(true);
      } else if (event.type === "connection:restored") {
        setConnected(true);
        setReconnecting(false);
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
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function handleClaim() {
    if (!conversation) {
      return;
    }
    const isReassign = conversation.assignedUserId !== null && conversation.assignedUserId !== sessionUser.userId;
    if (isReassign) {
      setReassignConfirmOpen(true);
      return;
    }
    void performClaim();
  }

  async function performClaim() {
    setBusy(true);
    try {
      await apiFetch(`/conversations/${conversationId}/claim`, { method: "POST" });
      await loadDetail();
    } finally {
      setBusy(false);
      setReassignConfirmOpen(false);
    }
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

  if (!conversation) {
    return <PageSkeleton />;
  }

  const isMine = conversation.assignedUserId === sessionUser.userId;
  const claimLabel = !conversation.assignedUserId ? "Claim" : isMine ? null : "Reassign to me";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/conversations" className="text-sm text-slate-500 hover:text-slate-700 hover:underline">
              ← Back to queue
            </Link>
            <h1 className="mt-1 text-lg font-semibold text-slate-900">Conversation {conversation.id.slice(0, 8)}</h1>
          </div>
          <div className="flex items-center gap-2">
            {claimLabel && (
              <Button size="sm" onClick={handleClaim} disabled={busy}>
                {claimLabel}
              </Button>
            )}
            {isMine && <Badge tone="info">Assigned to you</Badge>}
            <Select
              value={conversation.status}
              onChange={(event) => handleStatusChange(event.target.value as "resolved" | "closed" | "open")}
              className="py-1.5"
            >
              {!["open", "resolved", "closed"].includes(conversation.status) && (
                <option value={conversation.status} disabled>
                  {conversation.status}
                </option>
              )}
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </Select>
          </div>
        </div>

        <ConfirmDialog
          open={reassignConfirmOpen}
          onOpenChange={setReassignConfirmOpen}
          title="Reassign this conversation?"
          description={`It's currently assigned to ${conversation.assignedUserName}. Reassigning moves it to you.`}
          confirmLabel="Reassign to me"
          tone="default"
          busy={busy}
          onConfirm={performClaim}
        />

        {escalations.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
            <div className="mb-2 font-medium text-amber-800">
              Escalated {escalations.length > 1 ? `${escalations.length} times` : "once"} - every reason, oldest first
              (a human may need to address more than just the latest):
            </div>
            <ul className="space-y-2">
              {escalations.map((escalation) => (
                <li key={escalation.id} className="border-l-2 border-amber-300 pl-2">
                  <div className="font-medium text-amber-800">
                    {ESCALATION_REASON_LABELS[escalation.reason] ?? escalation.reason}{" "}
                    <span className="font-normal text-amber-600">
                      {new Date(escalation.escalatedAt).toLocaleString()}
                    </span>
                  </div>
                  {escalation.detail && <p className="text-amber-700">{escalation.detail}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Card className="mb-4">
          <CardBody className="text-sm">
            {conversation.metadata.aiSummary ? (
              <p className="text-slate-700">{conversation.metadata.aiSummary.text}</p>
            ) : (
              <p className="text-slate-500">No summary yet.</p>
            )}
            <button onClick={handleSummarize} disabled={busy} className="mt-2 text-xs text-slate-500 underline disabled:opacity-50">
              {conversation.metadata.aiSummary ? "Regenerate summary" : "Summarize"}
            </button>
          </CardBody>
        </Card>

        <Card className="mb-3">
          <div ref={scrollRef} className="flex h-96 flex-col gap-3 overflow-y-auto p-3">
            {!connected && <p className="text-sm text-slate-500">{reconnecting ? "Reconnecting..." : "Connecting..."}</p>}
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {typing && (
              <div className="flex items-center gap-1 self-end rounded-2xl rounded-br-sm bg-fill-muted px-3 py-2">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-fill/70 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-fill/70 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-fill/70" />
              </div>
            )}
          </div>
        </Card>

        {error && <div className="mb-2"><InlineError message={error} /></div>}

        <form onSubmit={handleSend} className="flex gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a reply..."
            className="flex-1"
          />
          <Button type="button" variant="outline" onClick={handleSuggest} disabled={busy}>
            Suggest
          </Button>
          <Button type="submit" disabled={busy || !draft.trim()}>
            Send
          </Button>
        </form>
      </div>

      <aside className="w-full shrink-0 lg:w-64">
        {escalationContact && (
          <div className="mb-4">
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">Follow-up contact</h2>
            <Card>
              <CardBody className="text-sm">
                <div className="font-medium text-slate-900">{escalationContact.name}</div>
                <div className="text-slate-500">
                  {escalationContact.contactMethod === "email" ? "Email" : "Phone"}: {escalationContact.contactValue}
                </div>
              </CardBody>
            </Card>
          </div>
        )}

        {hubspotConnected && (
          <div className="mb-4">
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">CRM</h2>
            <form onSubmit={handleContactLookup} className="flex flex-col gap-2">
              <Input
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder="Customer email"
                type="email"
                className="py-1.5"
              />
              {contactError && <InlineError message={contactError} />}
              <Button type="submit" variant="outline" size="sm" disabled={contactBusy || !contactEmail.trim()}>
                {contactBusy ? "Looking up..." : "Check contact"}
              </Button>
            </form>
          </div>
        )}

        <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">Internal notes</h2>
        <Card>
          <CardBody className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {notes.length === 0 && <li className="text-sm text-slate-500">No notes yet.</li>}
              {notes.map((note) => (
                <li key={note.id} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm">
                  <div className="mb-1 text-xs font-medium text-amber-800">{note.authorName}</div>
                  {note.content}
                </li>
              ))}
            </ul>
            <form onSubmit={handleAddNote} className="flex flex-col gap-2">
              <Textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="Add a note (not visible to the customer)..."
                rows={3}
                className="py-1.5"
              />
              <Button type="submit" variant="outline" size="sm">
                Add note
              </Button>
            </form>
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}
