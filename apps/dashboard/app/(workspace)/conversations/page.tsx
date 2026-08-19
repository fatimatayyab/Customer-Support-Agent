"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";

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

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  waiting_for_customer: "Waiting for customer",
  escalated: "Escalated",
  assigned: "Assigned",
  resolved: "Resolved",
  closed: "Closed",
};

const STATUS_TONES: Record<string, BadgeTone> = {
  open: "neutral",
  waiting_for_customer: "neutral",
  escalated: "warning",
  assigned: "info",
  resolved: "success",
  closed: "neutral",
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

const TAB_LABELS: Record<FilterTab, string> = {
  unassigned: "Unassigned",
  mine: "Mine",
  "needs-follow-up": "Needs follow-up",
  all: "All",
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
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Conversations</h1>

      <div className="mb-4 flex gap-2">
        {(["unassigned", "mine", "needs-follow-up", "all"] as const).map((option) => (
          <button
            key={option}
            onClick={() => setTab(option)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              tab === option ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {TAB_LABELS[option]}
          </button>
        ))}
      </div>

      {conversations === null && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {conversations?.length === 0 && (
        <EmptyState icon={MessageSquare} title="No conversations here" description="Nothing matches this filter right now." />
      )}

      {conversations && conversations.length > 0 && (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {conversations.map((conversation) => (
            <Link
              key={conversation.id}
              href={`/conversations/${conversation.id}`}
              className="flex items-center justify-between gap-4 p-3.5 text-sm transition-colors hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-400">{conversation.id.slice(0, 8)}</span>
                  <Badge tone={STATUS_TONES[conversation.status] ?? "neutral"}>
                    {STATUS_LABELS[conversation.status] ?? conversation.status}
                  </Badge>
                  {conversation.metadata.escalation && (
                    <span className="truncate text-xs text-amber-700">
                      {ESCALATION_REASON_LABELS[conversation.metadata.escalation.reason] ??
                        conversation.metadata.escalation.reason}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-slate-500">
                {conversation.assignedUserName ?? "Unassigned"} ·{" "}
                {new Date(conversation.updatedAt).toLocaleTimeString()}
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
