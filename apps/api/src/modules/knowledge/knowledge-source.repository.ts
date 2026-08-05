import { and, desc, eq } from "drizzle-orm";
import { knowledgeSources, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

type NewKnowledgeSource = Pick<
  typeof knowledgeSources.$inferInsert,
  "workspaceId" | "type" | "title" | "content" | "sourceLocation"
>;
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

// Separate from updateKnowledgeSourceStatus - single responsibility, and
// this one only applies to a website source once its background fetch
// resolves (see processKnowledgeSource). title is optional: a
// successful fetch that didn't find a real <title> keeps the URL
// placeholder set at creation rather than overwriting it with nothing.
export async function updateKnowledgeSourceContent(
  scopedDb: ScopedDb,
  workspaceId: string,
  id: string,
  update: { title?: string; content: string },
) {
  await scopedDb
    .update(knowledgeSources)
    .set({ ...update, updatedAt: new Date() })
    .where(and(eq(knowledgeSources.id, id), eq(knowledgeSources.workspaceId, workspaceId)));
}

// Duplicate-prevention for website ingestion: checked before inserting a
// new URL so re-adding a page a workspace already ingested returns a
// friendly "already added" outcome instead of a redundant source that
// gets separately chunked and embedded (real, wasted provider cost).
export async function getKnowledgeSourceBySourceLocation(scopedDb: ScopedDb, workspaceId: string, sourceLocation: string) {
  const [source] = await scopedDb
    .select()
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.sourceLocation, sourceLocation)))
    .limit(1);
  return source ?? null;
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
