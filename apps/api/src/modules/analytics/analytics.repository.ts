import { and, eq, gte, sql } from "drizzle-orm";
import { conversationRatings, conversations, knowledgeSources, messages, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

export interface VolumeByDay {
  date: string;
  count: number;
}

// date_trunc + to_char rather than grouping by the raw timestamp column -
// collapses every conversation created the same calendar day into one
// bucket regardless of time-of-day, and to_char formats it as a plain
// 'YYYY-MM-DD' string so the dashboard doesn't need to re-parse a
// timezone-bearing timestamp just to render an axis label.
export async function getConversationVolumeByDay(
  scopedDb: ScopedDb,
  workspaceId: string,
  since: Date,
): Promise<VolumeByDay[]> {
  const day = sql`date_trunc('day', ${conversations.createdAt})`;
  return scopedDb
    .select({
      date: sql<string>`to_char(${day}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .where(and(eq(conversations.workspaceId, workspaceId), gte(conversations.createdAt, since)))
    .groupBy(day)
    .orderBy(day);
}

export interface StatusCount {
  status: string;
  count: number;
}

export async function getConversationStatusBreakdown(
  scopedDb: ScopedDb,
  workspaceId: string,
  since: Date,
): Promise<StatusCount[]> {
  return scopedDb
    .select({ status: conversations.status, count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(eq(conversations.workspaceId, workspaceId), gte(conversations.createdAt, since)))
    .groupBy(conversations.status);
}

export interface EscalationReasonCount {
  reason: string;
  count: number;
}

// A conversation's `metadata.escalation` is merged in once and never
// cleared (see conversation.repository.ts's escalateConversation) - it
// survives the conversation later moving to resolved/closed. Counting on
// this field, not current status = 'escalated', is what makes this a
// real "was ever escalated" metric instead of undercounting every
// escalation a human has since resolved.
export async function getEscalationReasonBreakdown(
  scopedDb: ScopedDb,
  workspaceId: string,
  since: Date,
): Promise<EscalationReasonCount[]> {
  const reason = sql`${conversations.metadata}->'escalation'->>'reason'`;
  return scopedDb
    .select({ reason: sql<string>`${reason}`, count: sql<number>`count(*)::int` })
    .from(conversations)
    .where(
      and(eq(conversations.workspaceId, workspaceId), gte(conversations.createdAt, since), sql`${reason} is not null`),
    )
    .groupBy(reason);
}

export interface CsatCount {
  rating: string;
  count: number;
}

// Filtered on the rating's own createdAt (when it was submitted), not
// the conversation's - consistent with how every other breakdown here
// filters on the timestamp of the thing actually being counted.
export async function getCsatBreakdown(scopedDb: ScopedDb, workspaceId: string, since: Date): Promise<CsatCount[]> {
  return scopedDb
    .select({ rating: conversationRatings.rating, count: sql<number>`count(*)::int` })
    .from(conversationRatings)
    .where(and(eq(conversationRatings.workspaceId, workspaceId), gte(conversationRatings.createdAt, since)))
    .groupBy(conversationRatings.rating);
}

export interface AiProviderStats {
  provider: string;
  count: number;
  avgConfidence: number | null;
}

export interface AiModelStats {
  model: string;
  count: number;
  avgConfidence: number | null;
}

export interface AiMessageStats {
  totalAiMessages: number;
  avgConfidence: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: AiProviderStats[];
  byModel: AiModelStats[];
}

// Only 'ai' messages ever populate `metadata` with this shape (see
// message.repository.ts's MessageMetadata) - every extraction here
// reads a jsonb path, not a real column, since there's no dedicated
// analytics table (this milestone is read-only over existing data).
export async function getAiMessageStats(scopedDb: ScopedDb, workspaceId: string, since: Date): Promise<AiMessageStats> {
  // Cast to ::float per-row so avg()/comparisons operate on double
  // precision, not Postgres's numeric type - numeric comes back from the
  // pg driver as a string, float8 comes back as a real JS number.
  const confidence = sql`(${messages.metadata}->>'confidence')::float`;
  const provider = sql`${messages.metadata}->>'provider'`;
  const model = sql`${messages.metadata}->>'model'`;
  // sum(int) is bigint in Postgres, which the pg driver returns as a
  // string - the outer ::int cast keeps this a plain number for
  // token counts that will never realistically exceed int4 range.
  const inputTokens = sql`(${messages.metadata}->'usage'->>'inputTokens')::int`;
  const outputTokens = sql`(${messages.metadata}->'usage'->>'outputTokens')::int`;

  const baseCondition = and(
    eq(messages.workspaceId, workspaceId),
    eq(messages.senderType, "ai"),
    gte(messages.createdAt, since),
  );

  const [overall] = await scopedDb
    .select({
      totalAiMessages: sql<number>`count(*)::int`,
      avgConfidence: sql<number | null>`avg(${confidence})`,
      totalInputTokens: sql<number>`coalesce(sum(${inputTokens}), 0)::int`,
      totalOutputTokens: sql<number>`coalesce(sum(${outputTokens}), 0)::int`,
    })
    .from(messages)
    .where(baseCondition);

  const byProvider = await scopedDb
    .select({
      provider: sql<string>`${provider}`,
      count: sql<number>`count(*)::int`,
      avgConfidence: sql<number | null>`avg(${confidence})`,
    })
    .from(messages)
    .where(baseCondition)
    .groupBy(provider)
    .orderBy(sql`count(*) desc`);

  const byModel = await scopedDb
    .select({
      model: sql<string>`${model}`,
      count: sql<number>`count(*)::int`,
      avgConfidence: sql<number | null>`avg(${confidence})`,
    })
    .from(messages)
    .where(baseCondition)
    .groupBy(model)
    .orderBy(sql`count(*) desc`);

  // count(*) with no GROUP BY always returns exactly one row, even over
  // zero matching messages (count: 0, avg: null) - overall is never
  // actually undefined, so this is the guaranteed-non-empty case
  // assertDefined exists for, not a real runtime possibility.
  const overallRow = assertDefined(overall, "getAiMessageStats: unconditioned aggregate produced no row.");

  return {
    totalAiMessages: overallRow.totalAiMessages,
    avgConfidence: overallRow.avgConfidence,
    totalInputTokens: overallRow.totalInputTokens,
    totalOutputTokens: overallRow.totalOutputTokens,
    byProvider,
    byModel,
  };
}

export interface TopCitedSource {
  knowledgeSourceId: string;
  title: string;
  citationCount: number;
}

// scopedDb.execute()'s generic requires an index signature (it doesn't
// know the row shape statically the way the query builder does) -
// TopCitedSource itself stays a plain, exported DTO with no index
// signature leaking into its public shape.
type TopCitedSourceRow = TopCitedSource & Record<string, unknown>;

// jsonb_array_elements over messages.metadata->'citations' has no
// equivalent in drizzle's fluent query builder, so this is raw SQL via
// .execute() (the same escape hatch tenant-context.ts uses for
// set_config) - but every table/column reference still goes through the
// real drizzle schema objects, not hand-written snake_case, so a future
// column rename doesn't leave a silently-broken string behind.
export async function getTopCitedKnowledgeSources(
  scopedDb: ScopedDb,
  workspaceId: string,
  since: Date,
  limit: number,
): Promise<TopCitedSource[]> {
  const result = await scopedDb.execute<TopCitedSourceRow>(sql`
    select
      ${knowledgeSources.id} as "knowledgeSourceId",
      ${knowledgeSources.title} as "title",
      count(*)::int as "citationCount"
    from ${messages}
    cross join lateral jsonb_array_elements(${messages.metadata}->'citations') as citation
    join ${knowledgeSources} on ${knowledgeSources.id} = (citation->>'knowledgeSourceId')::uuid
    where ${messages.workspaceId} = ${workspaceId}
      and ${messages.senderType} = 'ai'
      and ${messages.createdAt} >= ${since}
      and ${knowledgeSources.workspaceId} = ${workspaceId}
    group by ${knowledgeSources.id}, ${knowledgeSources.title}
    order by count(*) desc
    limit ${limit}
  `);
  return result.rows;
}
