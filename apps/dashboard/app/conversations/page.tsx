"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

interface ConversationSummary {
  id: string;
  status: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  metadata: { escalation?: { reason: string; detail: string } };
  createdAt: string;
  updatedAt: string;
}

const ESCALATION_REASON_LABELS: Record<string, string> = {
  no_relevant_knowledge: "No matching knowledge",
  low_confidence: "Low AI confidence",
  ai_requested_escalation: "AI requested a human",
  ai_provider_error: "AI provider error",
  customer_requested_human: "Customer asked for a human",
};

type FilterTab = "unassigned" | "mine" | "needs-follow-up" | "all";

const POLL_INTERVAL_MS = 5000;

// "Needs follow-up" = escalated and nobody's picked it up yet - no new
// backend filter needed, GET /conversations already supports status and
// assigned as independent, combinable query params.
const TAB_QUERY: Record<FilterTab, string> = {
  unassigned: "?assigned=unassigned",
  mine: "?assigned=me",
  "needs-follow-up": "?status=escalated&assigned=unassigned",
  all: "",
};

export default function ConversationsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<FilterTab>("unassigned");
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const query = TAB_QUERY[tab];
      try {
        const data = await apiFetch<{ conversations: ConversationSummary[] }>(`/conversations${query}`);
        if (!cancelled) {
          setConversations(data?.conversations ?? []);
        }
      } catch {
        if (!cancelled) {
          router.push("/login");
        }
      }
    }

    load();
    const interval = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [tab, router]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Conversations</h1>
        <Link href="/" className="text-sm text-slate-500 underline">
          Back
        </Link>
      </div>

      <div className="mb-4 flex gap-2">
        {(["unassigned", "mine", "needs-follow-up", "all"] as const).map((option) => (
          <button
            key={option}
            onClick={() => setTab(option)}
            className={`rounded-full px-3 py-1 text-sm ${
              tab === option ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {option === "unassigned"
              ? "Unassigned"
              : option === "mine"
                ? "Mine"
                : option === "needs-follow-up"
                  ? "Needs follow-up"
                  : "All"}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
        {conversations === null && <li className="p-3 text-sm text-slate-500">Loading...</li>}
        {conversations?.length === 0 && <li className="p-3 text-sm text-slate-500">No conversations here.</li>}
        {conversations?.map((conversation) => (
          <li key={conversation.id}>
            <Link
              href={`/conversations/${conversation.id}`}
              className="flex items-center justify-between p-3 text-sm hover:bg-slate-50"
            >
              <div>
                <span className="font-mono text-xs text-slate-500">{conversation.id.slice(0, 8)}</span>{" "}
                <StatusBadge status={conversation.status} />
                {conversation.metadata.escalation && (
                  <span className="ml-2 text-xs text-amber-700">
                    {ESCALATION_REASON_LABELS[conversation.metadata.escalation.reason] ??
                      conversation.metadata.escalation.reason}
                  </span>
                )}
              </div>
              <div className="text-slate-500">
                {conversation.assignedUserName ?? "Unassigned"} ·{" "}
                {new Date(conversation.updatedAt).toLocaleTimeString()}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "text-slate-500",
    waiting_for_customer: "text-slate-500",
    escalated: "text-amber-600",
    assigned: "text-blue-600",
    resolved: "text-green-600",
    closed: "text-slate-400",
  };
  return <span className={colors[status] ?? "text-slate-500"}>{status}</span>;
}
