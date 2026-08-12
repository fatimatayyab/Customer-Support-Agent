"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";

interface VolumeByDay {
  date: string;
  count: number;
}

interface StatusCount {
  status: string;
  count: number;
}

interface EscalationReasonCount {
  reason: string;
  count: number;
}

interface AiProviderStats {
  provider: string;
  count: number;
  avgConfidence: number | null;
}

interface AiModelStats {
  model: string;
  count: number;
  avgConfidence: number | null;
}

interface AiStats {
  totalAiMessages: number;
  avgConfidence: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: AiProviderStats[];
  byModel: AiModelStats[];
}

interface TopCitedSource {
  knowledgeSourceId: string;
  title: string;
  citationCount: number;
}

interface CsatCount {
  rating: string;
  count: number;
}

interface AnalyticsOverview {
  rangeDays: number;
  totalConversations: number;
  resolutionRate: number | null;
  escalationRate: number | null;
  volumeByDay: VolumeByDay[];
  statusBreakdown: StatusCount[];
  escalationReasonBreakdown: EscalationReasonCount[];
  aiStats: AiStats;
  topCitedSources: TopCitedSource[];
  totalRatings: number;
  csatScore: number | null;
  csatBreakdown: CsatCount[];
}

const RANGE_OPTIONS = [7, 30, 90] as const;

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  waiting_for_customer: "Waiting for customer",
  escalated: "Escalated",
  assigned: "Assigned",
  resolved: "Resolved",
  closed: "Closed",
};

const ESCALATION_REASON_LABELS: Record<string, string> = {
  no_relevant_knowledge: "No relevant knowledge",
  low_confidence: "Low confidence",
  ai_requested_escalation: "AI requested escalation",
  ai_provider_error: "AI provider error",
  customer_requested_human: "Customer asked for a human",
};

const CSAT_LABELS: Record<string, string> = {
  up: "Positive",
  down: "Negative",
};

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [days, setDays] = useState<number>(30);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch<{ overview: AnalyticsOverview }>(`/analytics/overview?days=${days}`)
      .then((data) => setOverview(data?.overview ?? null))
      .catch((err) => {
        // 401 means the session itself is gone - bounce to login like
        // every other page. A 403 (logged in, wrong role) is a real,
        // expected outcome for a support_agent - show it, don't redirect.
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Could not load analytics.");
      })
      .finally(() => setLoading(false));
  }, [days, router]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Analytics</h1>
        <Link href="/" className="text-sm text-slate-500 underline">
          Back
        </Link>
      </div>

      <div className="mb-6 flex gap-2">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option}
            onClick={() => setDays(option)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              days === option ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-600"
            }`}
          >
            Last {option} days
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading && !overview && !error && <p className="text-sm text-slate-500">Loading...</p>}

      {overview && (
        <div className="flex flex-col gap-10">
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <StatTile label="Conversations" value={String(overview.totalConversations)} />
            <StatTile label="Resolution rate" value={formatPercent(overview.resolutionRate)} />
            <StatTile label="Escalation rate" value={formatPercent(overview.escalationRate)} />
            <StatTile label="Customer satisfaction" value={formatPercent(overview.csatScore)} />
            <StatTile
              label="Avg. AI confidence"
              value={overview.aiStats.avgConfidence === null ? "—" : overview.aiStats.avgConfidence.toFixed(2)}
            />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Conversation volume</h2>
            {overview.volumeByDay.length === 0 ? (
              <p className="text-sm text-slate-500">No conversations in this range.</p>
            ) : (
              <BarList items={overview.volumeByDay.map((row) => ({ label: row.date, value: row.count }))} />
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Conversations by status</h2>
            {overview.statusBreakdown.length === 0 ? (
              <p className="text-sm text-slate-500">No conversations in this range.</p>
            ) : (
              <BarList
                items={overview.statusBreakdown.map((row) => ({
                  label: STATUS_LABELS[row.status] ?? row.status,
                  value: row.count,
                }))}
              />
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Escalation reasons</h2>
            {overview.escalationReasonBreakdown.length === 0 ? (
              <p className="text-sm text-slate-500">No escalations in this range.</p>
            ) : (
              <BarList
                items={overview.escalationReasonBreakdown.map((row) => ({
                  label: ESCALATION_REASON_LABELS[row.reason] ?? row.reason,
                  value: row.count,
                }))}
              />
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Customer satisfaction</h2>
            {overview.totalRatings === 0 ? (
              <p className="text-sm text-slate-500">No ratings in this range.</p>
            ) : (
              <BarList
                items={overview.csatBreakdown.map((row) => ({
                  label: CSAT_LABELS[row.rating] ?? row.rating,
                  value: row.count,
                }))}
              />
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">AI performance</h2>
            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatTile label="AI replies" value={String(overview.aiStats.totalAiMessages)} />
              <StatTile label="Input tokens" value={overview.aiStats.totalInputTokens.toLocaleString()} />
              <StatTile label="Output tokens" value={overview.aiStats.totalOutputTokens.toLocaleString()} />
            </div>
            {overview.aiStats.totalAiMessages === 0 ? (
              <p className="text-sm text-slate-500">No AI replies in this range.</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">By provider</h3>
                  <StatsTable rows={overview.aiStats.byProvider.map((row) => ({ label: row.provider, ...row }))} />
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">By model</h3>
                  <StatsTable rows={overview.aiStats.byModel.map((row) => ({ label: row.model, ...row }))} />
                </div>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Most-cited knowledge sources</h2>
            {overview.topCitedSources.length === 0 ? (
              <p className="text-sm text-slate-500">No AI replies cited a knowledge source in this range.</p>
            ) : (
              <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
                {overview.topCitedSources.map((source) => (
                  <li key={source.knowledgeSourceId} className="flex items-center justify-between p-3 text-sm">
                    <span>{source.title}</span>
                    <span className="text-slate-500">
                      {source.citationCount} citation{source.citationCount === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 p-4">
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

// Plain CSS width-percentage bars, not a charting dependency - this is
// the first chart-shaped UI anywhere in the dashboard, and a handful of
// horizontal bars don't justify a new dependency yet.
function BarList({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-3 text-sm">
          <span className="w-36 shrink-0 truncate text-slate-500">{item.label}</span>
          <div className="h-3 flex-1 rounded-full bg-slate-100">
            <div className="h-3 rounded-full bg-slate-900" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right text-slate-500">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

function StatsTable({ rows }: { rows: { label: string; count: number; avgConfidence: number | null }[] }) {
  return (
    <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center justify-between p-3 text-sm">
          <span>{row.label}</span>
          <span className="text-slate-500">
            {row.count} repl{row.count === 1 ? "y" : "ies"}
            {row.avgConfidence !== null && ` · avg confidence ${row.avgConfidence.toFixed(2)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
