import { eq, sql } from "drizzle-orm";
import { knowledgeChunks, type ScopedDb } from "@csa/db";

type NewKnowledgeChunk = Pick<
  typeof knowledgeChunks.$inferInsert,
  "workspaceId" | "knowledgeSourceId" | "content" | "embedding" | "chunkOrder"
>;

export async function insertKnowledgeChunks(scopedDb: ScopedDb, chunks: NewKnowledgeChunk[]) {
  if (chunks.length === 0) {
    return [];
  }
  return scopedDb.insert(knowledgeChunks).values(chunks).returning();
}

export interface SimilarChunk {
  id: string;
  content: string;
  knowledgeSourceId: string;
  similarity: number;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function searchSimilarChunks(
  scopedDb: ScopedDb,
  workspaceId: string,
  queryEmbedding: number[],
  limit: number,
): Promise<SimilarChunk[]> {
  // Cosine distance (<=>), matching the vector_cosine_ops HNSW index -
  // similarity is just 1 - distance. Explicit ::vector cast rather than
  // relying on implicit cast resolution for a bound text parameter.
  const distance = sql<number>`${knowledgeChunks.embedding} <=> ${toVectorLiteral(queryEmbedding)}::vector`;

  const rows = await scopedDb
    .select({
      id: knowledgeChunks.id,
      content: knowledgeChunks.content,
      knowledgeSourceId: knowledgeChunks.knowledgeSourceId,
      distance,
    })
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.workspaceId, workspaceId))
    .orderBy(distance)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    knowledgeSourceId: row.knowledgeSourceId,
    similarity: 1 - row.distance,
  }));
}
