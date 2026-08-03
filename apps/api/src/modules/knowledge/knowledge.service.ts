import { withWorkspaceContext } from "@csa/db";
import { assertDefined } from "../../assert.js";
import { AppError, NotFoundError } from "../../errors.js";
import { chunkText } from "./chunker.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { insertKnowledgeChunks, searchSimilarChunks, type SimilarChunk } from "./knowledge-chunk.repository.js";
import {
  deleteKnowledgeSource,
  getKnowledgeSourceById,
  insertKnowledgeSource,
  listKnowledgeSources,
  updateKnowledgeSourceStatus,
} from "./knowledge-source.repository.js";
import { VoyageEmbeddingProvider } from "./voyage-embedding-provider.js";

const SUPPORTED_INGESTION_TYPES = ["plain_text", "faq"] as const;
type SupportedIngestionType = (typeof SUPPORTED_INGESTION_TYPES)[number];

const DEFAULT_SEARCH_LIMIT = 5;

// Swappable per the EmbeddingProvider abstraction - Voyage is the only
// implementation today, but nothing below this line depends on that.
const embeddingProvider: EmbeddingProvider = new VoyageEmbeddingProvider();

export class UnsupportedSourceTypeError extends AppError {
  constructor(type: string) {
    super(
      `Knowledge source type "${type}" is not supported yet. Only plain_text and faq are implemented in this phase.`,
      400,
    );
  }
}

function isSupportedIngestionType(type: string): type is SupportedIngestionType {
  return (SUPPORTED_INGESTION_TYPES as readonly string[]).includes(type);
}

interface CreateKnowledgeSourceParams {
  workspaceId: string;
  type: string;
  title: string;
  content: string;
}

export async function createKnowledgeSource(params: CreateKnowledgeSourceParams) {
  if (!isSupportedIngestionType(params.type)) {
    throw new UnsupportedSourceTypeError(params.type);
  }
  // Narrowed via the type guard above, but that narrowing doesn't
  // survive a property access inside a closure - pin it to a local first.
  const type = params.type;

  const source = await withWorkspaceContext(params.workspaceId, (scopedDb) =>
    insertKnowledgeSource(scopedDb, {
      workspaceId: params.workspaceId,
      type,
      title: params.title,
      content: params.content,
    }),
  );

  // Not awaited: chunking + embedding a document can take a few seconds
  // and there's no reason to hold the HTTP response open for it. This is
  // in-process background work, not a real job queue - if the API
  // restarts mid-processing, that source is stuck in 'processing' until
  // manually retried. Acceptable for Phase 2's text-only sources; a real
  // queue (with retries) becomes worth the complexity once pdf/website
  // ingestion makes this take much longer or run at real volume.
  void processKnowledgeSource(params.workspaceId, source.id).catch(() => {
    // Failure is already recorded on the source row itself, inside
    // processKnowledgeSource's catch block.
  });

  return source;
}

export async function listSources(workspaceId: string) {
  return withWorkspaceContext(workspaceId, (scopedDb) => listKnowledgeSources(scopedDb, workspaceId));
}

export async function removeKnowledgeSource(workspaceId: string, id: string): Promise<void> {
  const deleted = await withWorkspaceContext(workspaceId, (scopedDb) =>
    deleteKnowledgeSource(scopedDb, workspaceId, id),
  );
  if (!deleted) {
    throw new NotFoundError("Knowledge source not found.");
  }
}

export async function searchKnowledge(
  workspaceId: string,
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): Promise<SimilarChunk[]> {
  const queryEmbedding = await embeddingProvider.embedQuery(query);
  return withWorkspaceContext(workspaceId, (scopedDb) =>
    searchSimilarChunks(scopedDb, workspaceId, queryEmbedding, limit),
  );
}

async function processKnowledgeSource(workspaceId: string, sourceId: string): Promise<void> {
  try {
    await withWorkspaceContext(workspaceId, (scopedDb) =>
      updateKnowledgeSourceStatus(scopedDb, workspaceId, sourceId, { status: "processing" }),
    );

    const source = await withWorkspaceContext(workspaceId, (scopedDb) =>
      getKnowledgeSourceById(scopedDb, workspaceId, sourceId),
    );
    if (!source?.content) {
      throw new Error("Knowledge source has no content to process.");
    }

    const chunks = chunkText(source.content);
    if (chunks.length === 0) {
      throw new Error("Knowledge source content produced no chunks.");
    }

    const embeddings = await embeddingProvider.embedDocuments(chunks);
    if (embeddings.length !== chunks.length) {
      throw new Error("Embedding provider returned a different number of vectors than chunks.");
    }

    await withWorkspaceContext(workspaceId, (scopedDb) =>
      insertKnowledgeChunks(
        scopedDb,
        chunks.map((content, index) => ({
          workspaceId,
          knowledgeSourceId: sourceId,
          content,
          embedding: assertDefined(embeddings[index], `processKnowledgeSource: missing embedding at index ${index}.`),
          chunkOrder: index,
        })),
      ),
    );

    await withWorkspaceContext(workspaceId, (scopedDb) =>
      updateKnowledgeSourceStatus(scopedDb, workspaceId, sourceId, { status: "completed", failureReason: null }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error during processing.";
    await withWorkspaceContext(workspaceId, (scopedDb) =>
      updateKnowledgeSourceStatus(scopedDb, workspaceId, sourceId, { status: "failed", failureReason: message }),
    ).catch(() => {});
    throw error;
  }
}
