import { integrationActionLogs, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

type NewIntegrationActionLog = Pick<
  typeof integrationActionLogs.$inferInsert,
  "workspaceId" | "integrationId" | "conversationId" | "actionName" | "requestParams" | "resultStatus" | "resultSummary" | "triggeredByUserId"
>;

export async function insertIntegrationActionLog(scopedDb: ScopedDb, params: NewIntegrationActionLog) {
  const [log] = await scopedDb.insert(integrationActionLogs).values(params).returning();
  return assertDefined(log, "insertIntegrationActionLog: INSERT ... RETURNING produced no row.");
}
