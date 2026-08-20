"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { InlineError } from "@/components/ui/error-state";
import { apiFetch, ApiError } from "@/lib/api";

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

// The API only returns rows for days that actually had a conversation
// (a plain GROUP BY, no zero-fill - see getConversationVolumeByDay) -
// charting that directly would compress empty stretches and misrepresent
// the trend. Zero-filling here, client-side, keeps the API a plain
// aggregation query while making the chart actually correct.
function buildDailySeries(volumeByDay: VolumeByDay[], days: number): VolumeByDay[] {
  const byDate = new Map(volumeByDay.map((row) => [row.date, row.count]));
  const series: VolumeByDay[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    series.push({ date: key, count: byDate.get(key) ?? 0 });
  }
  return series;
}

function formatChartDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">Analytics</h1>

      <div className="mb-6 flex gap-2">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option}
            onClick={() => setDays(option)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              days === option ? "border-brand bg-brand text-on-fill" : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            Last {option} days
          </button>
        ))}
      </div>

      {error && <InlineError message={error} />}

      {loading && !overview && !error && <p className="text-sm text-slate-500">Loading...</p>}

      {overview && (
        <div className="flex flex-col gap-6">
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

          <Card>
            <CardHeader title="Conversation volume" />
            <CardBody>
              {overview.volumeByDay.length === 0 ? (
                <p className="text-sm text-slate-500">No conversations in this range.</p>
              ) : (
                <VolumeChart data={buildDailySeries(overview.volumeByDay, overview.rangeDays)} />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Conversations by status" />
            <CardBody>
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
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Escalation reasons" />
            <CardBody>
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
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Customer satisfaction" />
            <CardBody>
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
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="AI performance" />
            <CardBody className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Most-cited knowledge sources" />
            <CardBody>
              {overview.topCitedSources.length === 0 ? (
                <p className="text-sm text-slate-500">No AI replies cited a knowledge source in this range.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {overview.topCitedSources.map((source) => (
                    <li key={source.knowledgeSourceId} className="flex items-center justify-between p-3 text-sm">
                      <span className="text-slate-700">{source.title}</span>
                      <span className="text-slate-500">
                        {source.citationCount} citation{source.citationCount === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-elevation-sm">
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

// Hand-rolled SVG, not a charting dependency - a single line/area chart
// doesn't justify one, matching the reasoning that already kept every
// other primitive in this codebase (Tabs, Accordion, ConfirmDialog,
// Toast) dependency-free. viewBox + preserveAspectRatio="none" lets it
// stretch to fill its container responsively with no resize JS.
function VolumeChart({ data }: { data: VolumeByDay[] }) {
  const width = 600;
  const height = 160;
  const padding = { top: 8, right: 8, bottom: 20, left: 8 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const max = Math.max(...data.map((d) => d.count), 1);
  const stepX = data.length > 1 ? innerWidth / (data.length - 1) : 0;

  const points = data.map((d, i) => ({
    x: padding.left + i * stepX,
    y: padding.top + innerHeight - (d.count / max) * innerHeight,
    ...d,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const floor = padding.top + innerHeight;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const areaPath =
    firstPoint && lastPoint
      ? `${linePath} L ${lastPoint.x.toFixed(1)} ${floor} L ${firstPoint.x.toFixed(1)} ${floor} Z`
      : "";

  const labelPoints = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]))
    .filter((i) => i >= 0)
    .map((i) => points[i])
    .filter((p) => p !== undefined);

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-40 w-full">
        <path d={areaPath} className="fill-brand" fillOpacity={0.08} />
        <path d={linePath} fill="none" className="stroke-brand" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {points.map((p) => (
          <circle key={p.date} cx={p.x} cy={p.y} r={2.5} className="fill-brand">
            <title>{`${formatChartDate(p.date)}: ${p.count}`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-slate-400">
        {labelPoints.map((p) => (
          <span key={p.date}>{formatChartDate(p.date)}</span>
        ))}
      </div>
    </div>
  );
}

// Plain CSS width-percentage bars, not a charting dependency - fine as-is
// for categorical comparisons (status/escalation/CSAT breakdowns), which
// is a genuinely correct chart shape for that data, not a placeholder.
function BarList({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-3 text-sm">
          <span className="w-36 shrink-0 truncate text-slate-500">{item.label}</span>
          <div className="h-3 flex-1 rounded-full bg-slate-100">
            <div className="h-3 rounded-full bg-brand" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right text-slate-500">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

function StatsTable({ rows }: { rows: { label: string; count: number; avgConfidence: number | null }[] }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center justify-between p-3 text-sm">
          <span className="text-slate-700">{row.label}</span>
          <span className="text-slate-500">
            {row.count} repl{row.count === 1 ? "y" : "ies"}
            {row.avgConfidence !== null && ` · avg confidence ${row.avgConfidence.toFixed(2)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
