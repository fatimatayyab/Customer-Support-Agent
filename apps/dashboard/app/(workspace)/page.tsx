"use client";

import { BarChart3, BookOpen, Code2, MessageSquare, Plug, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session-context";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  administrator: "Administrator",
  support_agent: "Support Agent",
};

interface QuickLink {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface QueueStat {
  key: string;
  label: string;
  query: string;
}

// The same three filters the Conversations queue's own tabs use (see
// TAB_QUERY in conversations/page.tsx) - reused here, not duplicated
// business logic, just the same read-only queries against the same
// endpoint, to turn the home page into "what needs attention today"
// instead of just a link directory.
const QUEUE_STATS: QueueStat[] = [
  { key: "unassigned", label: "Unassigned", query: "?assigned=unassigned" },
  { key: "needs-follow-up", label: "Needs follow-up", query: "?status=escalated&assigned=unassigned" },
  { key: "mine", label: "Assigned to me", query: "?assigned=me" },
];

const QUICK_LINKS: QuickLink[] = [
  { href: "/conversations", label: "Conversations", description: "View and respond to the support queue", icon: MessageSquare },
  { href: "/knowledge", label: "Knowledge", description: "Manage what your assistant knows", icon: BookOpen },
  { href: "/widget", label: "Widget", description: "Install code and appearance", icon: Code2 },
  { href: "/analytics", label: "Analytics", description: "Volume, resolution, and AI performance", icon: BarChart3 },
  { href: "/integrations", label: "Integrations", description: "Connect HubSpot and other tools", icon: Plug },
  { href: "/team", label: "Team", description: "Members and invitations", icon: Users },
];

export default function DashboardHome() {
  const router = useRouter();
  const { user, workspace } = useSession();
  const [queueCounts, setQueueCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    Promise.all(
      QUEUE_STATS.map((stat) =>
        apiFetch<{ conversations: unknown[] }>(`/conversations${stat.query}`).then(
          (data) => [stat.key, data?.conversations.length ?? 0] as const,
        ),
      ),
    )
      .then((entries) => setQueueCounts(Object.fromEntries(entries)))
      .catch(() => router.push("/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-slate-900">{workspace.name}</h1>
        <p className="text-sm text-slate-500">
          {user.email} · {ROLE_LABELS[user.role] ?? user.role}
        </p>
      </div>

      <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">Needs attention</h2>
      <div className="mb-8 grid grid-cols-3 gap-3">
        {QUEUE_STATS.map((stat) => (
          <Link key={stat.key} href="/conversations">
            <Card className="p-4 transition-colors hover:border-slate-300 hover:shadow-elevation-md">
              {queueCounts ? (
                <div className="text-2xl font-semibold text-slate-900">{queueCounts[stat.key]}</div>
              ) : (
                <Skeleton className="h-8 w-10" />
              )}
              <div className="mt-1 text-xs font-medium tracking-wide text-slate-500 uppercase">{stat.label}</div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href}>
              <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:border-slate-300 hover:shadow-elevation-md">
                <Icon className="h-5 w-5 text-slate-500" strokeWidth={1.75} />
                <div className="text-sm font-medium text-slate-900">{link.label}</div>
                <div className="text-sm text-slate-500">{link.description}</div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
