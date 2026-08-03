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
  createdAt: string;
  updatedAt: string;
}

type FilterTab = "unassigned" | "mine" | "all";

const POLL_INTERVAL_MS = 5000;

export default function ConversationsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<FilterTab>("unassigned");
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const query = tab === "unassigned" ? "?assigned=unassigned" : tab === "mine" ? "?assigned=me" : "";
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
        {(["unassigned", "mine", "all"] as const).map((option) => (
          <button
            key={option}
            onClick={() => setTab(option)}
            className={`rounded-full px-3 py-1 text-sm ${
              tab === option ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {option === "unassigned" ? "Unassigned" : option === "mine" ? "Mine" : "All"}
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
