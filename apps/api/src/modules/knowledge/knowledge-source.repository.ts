import { and, desc, eq } from "drizzle-orm";
import { knowledgeSources, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

type NewKnowledgeSource = Pick<typeof knowledgeSources.$inferInsert, "workspaceId" | "type" | "title" | "content">;
type KnowledgeSourceStatus = (typeof knowledgeSources.$inferSelect)["status"];

export async function insertKnowledgeSource(scopedDb: ScopedDb, params: NewKnowledgeSource) {
  const [source] = await scopedDb.insert(knowledgeSources).values(params).returning();
  return assertDefined(source, "insertKnowledgeSource: INSERT ... RETURNING produced no row.");
}

export async function updateKnowledgeSourceStatus(
  scopedDb: ScopedDb,
  workspaceId: string,
  id: string,
  update: { status: KnowledgeSourceStatus; failureReason?: string | null },
) {
  await scopedDb
    .update(knowledgeSources)
    .set({ ...update, updatedAt: new Date() })
    .where(and(eq(knowledgeSources.id, id), eq(knowledgeSources.workspaceId, workspaceId)));
}

export async function getKnowledgeSourceById(scopedDb: ScopedDb, workspaceId: string, id: string) {
  const [source] = await scopedDb
    .select()
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.id, id), eq(knowledgeSources.workspaceId, workspaceId)))
    .limit(1);
  return source ?? null;
}

export async function listKnowledgeSources(scopedDb: ScopedDb, workspaceId: string) {
  return scopedDb
    .select()
    .from(knowledgeSources)
    .where(eq(knowledgeSources.workspaceId, workspaceId))
    .orderBy(desc(knowledgeSources.createdAt));
}

export async function deleteKnowledgeSource(scopedDb: ScopedDb, workspaceId: string, id: string) {
  const [deleted] = await scopedDb
    .delete(knowledgeSources)
    .where(and(eq(knowledgeSources.id, id), eq(knowledgeSources.workspaceId, workspaceId)))
    .returning({ id: knowledgeSources.id });
  return deleted ?? null;
}
