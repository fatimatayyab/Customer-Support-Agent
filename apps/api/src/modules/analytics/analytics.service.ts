import { withWorkspaceContext } from "@csa/db";
import {
  getAiMessageStats,
  getConversationStatusBreakdown,
  getConversationVolumeByDay,
  getCsatBreakdown,
  getDeflectionStats,
  getEscalationReasonBreakdown,
  getTopCitedKnowledgeSources,
  type AiMessageStats,
  type CsatCount,
  type EscalationReasonCount,
  type StatusCount,
  type TopCitedSource,
  type VolumeByDay,
} from "./analytics.repository.js";

const TOP_CITED_SOURCES_LIMIT = 10;

// A conversation counts as "resolved" for the resolution-rate metric in
// either terminal state - 'closed' isn't a separate outcome from
// 'resolved', just what happens after an agent tidies up the queue.
const RESOLVED_STATUSES = new Set(["resolved", "closed"]);

export interface AnalyticsOverview {
  rangeDays: number;
  totalConversations: number;
  // null (not 0) when there are no conversations in range - "0%
  // resolved" and "no data yet" are different states the dashboard
  // should render differently.
  resolutionRate: number | null;
  escalationRate: number | null;
  // Deflected = no escalation AND no agent messages AND no assignment
  // (see getDeflectionStats) - deliberately not status-based. null when
  // there are no conversations in range, matching resolution/escalation.
  deflectedCount: number;
  deflectionRate: number | null;
  volumeByDay: VolumeByDay[];
  statusBreakdown: StatusCount[];
  escalationReasonBreakdown: EscalationReasonCount[];
  aiStats: AiMessageStats;
  topCitedSources: TopCitedSource[];
  // Denominator is ratings submitted, not total conversations - most
  // conversations never get rated, so scoring against totalConversations
  // would silently understate a workspace that's actually doing well.
  totalRatings: number;
  csatScore: number | null;
  csatBreakdown: CsatCount[];
}

// Read-only aggregation over data every prior phase already writes -
// conversations.status/metadata, messages.metadata (AI replies), and
// knowledge_chunks citations - plus, as of the CSAT milestone,
// conversation_ratings (the one genuinely new capture surface Improve
// needed; everything else here reads data that already existed). See
// docs/07's Improve milestone entries for the full scoping discussion.
export async function getAnalyticsOverview(workspaceId: string, rangeDays: number): Promise<AnalyticsOverview> {
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

  // Sequential, not Promise.all: every query here shares the one pg
  // client withWorkspaceContext's transaction holds, and node-postgres
  // doesn't support concurrent queries on a single client (issuing them
  // concurrently just queues internally while logging a deprecation
  // warning today, and is slated to become a hard error in pg@9).
  const { volumeByDay, statusBreakdown, escalationReasonBreakdown, deflectionStats, aiStats, topCitedSources, csatBreakdown } =
    await withWorkspaceContext(workspaceId, async (scopedDb) => {
      const volumeByDay = await getConversationVolumeByDay(scopedDb, workspaceId, since);
      const statusBreakdown = await getConversationStatusBreakdown(scopedDb, workspaceId, since);
      const escalationReasonBreakdown = await getEscalationReasonBreakdown(scopedDb, workspaceId, since);
      const deflectionStats = await getDeflectionStats(scopedDb, workspaceId, since);
      const aiStats = await getAiMessageStats(scopedDb, workspaceId, since);
      const topCitedSources = await getTopCitedKnowledgeSources(scopedDb, workspaceId, since, TOP_CITED_SOURCES_LIMIT);
      const csatBreakdown = await getCsatBreakdown(scopedDb, workspaceId, since);
      return { volumeByDay, statusBreakdown, escalationReasonBreakdown, deflectionStats, aiStats, topCitedSources, csatBreakdown };
    });

  const totalConversations = statusBreakdown.reduce((sum, row) => sum + row.count, 0);
  const resolvedCount = statusBreakdown
    .filter((row) => RESOLVED_STATUSES.has(row.status))
    .reduce((sum, row) => sum + row.count, 0);
  const escalatedCount = escalationReasonBreakdown.reduce((sum, row) => sum + row.count, 0);

  const totalRatings = csatBreakdown.reduce((sum, row) => sum + row.count, 0);
  const upCount = csatBreakdown.find((row) => row.rating === "up")?.count ?? 0;

  return {
    rangeDays,
    totalConversations,
    resolutionRate: totalConversations > 0 ? resolvedCount / totalConversations : null,
    escalationRate: totalConversations > 0 ? escalatedCount / totalConversations : null,
    deflectedCount: deflectionStats.deflectedCount,
    deflectionRate: deflectionStats.totalCount > 0 ? deflectionStats.deflectedCount / deflectionStats.totalCount : null,
    volumeByDay,
    statusBreakdown,
    escalationReasonBreakdown,
    aiStats,
    topCitedSources,
    totalRatings,
    csatScore: totalRatings > 0 ? upCount / totalRatings : null,
    csatBreakdown,
  };
}
