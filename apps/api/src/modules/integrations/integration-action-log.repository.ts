import { and, count, eq } from "drizzle-orm";
import { integrationActionLogs, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

// Shared with countAiTriggeredLookups below, so the cap it enforces
// stays scoped to this one action - a bare `triggeredBy = 'ai'` filter
// with no actionName would pool a future second AI-triggered action's
// attempts into the same quota as this one's, invisibly.
export const CONTACT_LOOKUP_ACTION_NAME = "contact-lookup";

type NewIntegrationActionLog = Pick<
  typeof integrationActionLogs.$inferInsert,
  | "workspaceId"
  | "integrationId"
  | "conversationId"
  | "actionName"
  | "requestParams"
  | "resultStatus"
  | "resultSummary"
  | "triggeredBy"
  | "triggeredByUserId"
>;

export async function insertIntegrationActionLog(scopedDb: ScopedDb, params: NewIntegrationActionLog) {
  const [log] = await scopedDb.insert(integrationActionLogs).values(params).returning();
  return assertDefined(log, "insertIntegrationActionLog: INSERT ... RETURNING produced no row.");
}

// Backs the per-conversation cap on AI-triggered lookups
// (MAX_AI_TRIGGERED_LOOKUPS_PER_CONVERSATION, support-orchestrator.ts) -
// counts only actual executed attempts (this table's whole purpose),
// not rejected/unauthorized tool calls, which are never logged here.
// Scoped to CONTACT_LOOKUP_ACTION_NAME specifically, not just
// triggeredBy = 'ai', so a future second AI-triggered action gets its
// own independent quota rather than silently sharing this one's.
export async function countAiTriggeredLookups(
  scopedDb: ScopedDb,
  workspaceId: string,
  conversationId: string,
): Promise<number> {
  const [row] = await scopedDb
    .select({ count: count() })
    .from(integrationActionLogs)
    .where(
      and(
        eq(integrationActionLogs.workspaceId, workspaceId),
        eq(integrationActionLogs.conversationId, conversationId),
        eq(integrationActionLogs.triggeredBy, "ai"),
        eq(integrationActionLogs.actionName, CONTACT_LOOKUP_ACTION_NAME),
      ),
    );
  return row?.count ?? 0;
}
