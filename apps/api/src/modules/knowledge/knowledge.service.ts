import { withWorkspaceContext } from "@csa/db";
import { assertDefined } from "../../assert.js";
import { AppError, NotFoundError } from "../../errors.js";
import { chunkFaqContent, chunkText } from "./chunker.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { insertKnowledgeChunks, searchSimilarChunks, type SimilarChunk } from "./knowledge-chunk.repository.js";
import {
  deleteKnowledgeSource,
  getKnowledgeSourceById,
  getKnowledgeSourceBySourceLocation,
  insertKnowledgeSource,
  listKnowledgeSources,
  updateKnowledgeSourceContent,
  updateKnowledgeSourceStatus,
} from "./knowledge-source.repository.js";
import { extractDocxTextFromBuffer, extractPdfTextFromBuffer } from "./text-extraction.js";
import { VoyageEmbeddingProvider } from "./voyage-embedding-provider.js";
import { fetchAndExtractWebsiteText } from "./website-extraction.js";

const SUPPORTED_INGESTION_TYPES = ["plain_text", "faq"] as const;
type SupportedIngestionType = (typeof SUPPORTED_INGESTION_TYPES)[number];

type SupportedUploadType = "plain_text" | "pdf" | "docx";

// Maps a file extension to the knowledge_sources.type it produces and
// how to turn its bytes into text - separate from
// SUPPORTED_INGESTION_TYPES because an extension maps to a type, it
// isn't one directly (multiple extensions could map to the same type
// later, e.g. .markdown alongside .md). Extended one entry at a time as
// each format actually gets built.
const UPLOAD_EXTENSION_HANDLERS: Record<string, { type: SupportedUploadType; extract: (buffer: Buffer) => Promise<string> }> = {
  txt: { type: "plain_text", extract: (buffer) => Promise.resolve(buffer.toString("utf-8")) },
  md: { type: "plain_text", extract: (buffer) => Promise.resolve(buffer.toString("utf-8")) },
  pdf: { type: "pdf", extract: extractPdfTextFromBuffer },
  docx: { type: "docx", extract: extractDocxTextFromBuffer },
};

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

export class UnsupportedFileTypeError extends AppError {
  constructor(filename: string) {
    const extensions = Object.keys(UPLOAD_EXTENSION_HANDLERS)
      .map((ext) => `.${ext}`)
      .join(", ");
    super(`"${filename}" isn't a supported file type. Supported: ${extensions}.`, 400);
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

interface CreateKnowledgeSourceFromUploadParams {
  workspaceId: string;
  title: string;
  filename: string;
  buffer: Buffer;
}

// Extraction happens synchronously here, not in the background chunk/
// embed step below - it's fast and CPU-only (no external API call), so
// a corrupt/unreadable file fails immediately with a clear error
// instead of silently landing in status: 'failed' a few seconds later.
export async function createKnowledgeSourceFromUpload(params: CreateKnowledgeSourceFromUploadParams) {
  const extension = params.filename.split(".").pop()?.toLowerCase() ?? "";
  const handler = UPLOAD_EXTENSION_HANDLERS[extension];
  if (!handler) {
    throw new UnsupportedFileTypeError(params.filename);
  }
  const content = await handler.extract(params.buffer);

  const source = await withWorkspaceContext(params.workspaceId, (scopedDb) =>
    insertKnowledgeSource(scopedDb, {
      workspaceId: params.workspaceId,
      type: handler.type,
      title: params.title,
      content,
    }),
  );

  void processKnowledgeSource(params.workspaceId, source.id).catch(() => {});

  return source;
}

// Manually entered URLs, one source row per URL - not sitemap-driven
// bulk crawling, which is meaningfully more scope (crawl caps, dedup,
// partial-failure handling across an unbounded page count) for a
// capability a business can approximate today by pasting their most
// important pages directly. Capped defensively even though nothing
// external is billed per URL - N background fetches from one submission
// is still worth bounding.
const MAX_URLS_PER_SUBMISSION = 20;

interface CreateKnowledgeSourcesFromUrlsParams {
  workspaceId: string;
  urls: string[];
}

export async function createKnowledgeSourcesFromUrls(params: CreateKnowledgeSourcesFromUrlsParams) {
  const urls = params.urls.slice(0, MAX_URLS_PER_SUBMISSION);

  // Title is the URL itself until the background fetch (see
  // processKnowledgeSource) finds a real <title> and replaces it - the
  // network call is slow/can fail, so unlike file uploads it stays in
  // the async background step rather than blocking the response.
  //
  // Checked one at a time in the same loop, not batched separately -
  // an already-ingested URL is skipped (friendly, not an error) rather
  // than creating a redundant source that gets separately chunked and
  // re-embedded at real provider cost. Application-level check, not a
  // DB constraint: the realistic risk here is the same admin resubmitting
  // overlapping URL lists across separate dashboard sessions, not truly
  // concurrent requests racing each other - a DB-level guard would be
  // the fix if that assumption ever turns out wrong.
  const { sources, skipped } = await withWorkspaceContext(params.workspaceId, async (scopedDb) => {
    const created: Awaited<ReturnType<typeof insertKnowledgeSource>>[] = [];
    const alreadyExists: string[] = [];
    for (const url of urls) {
      const existing = await getKnowledgeSourceBySourceLocation(scopedDb, params.workspaceId, url);
      if (existing) {
        alreadyExists.push(url);
        continue;
      }
      const source = await insertKnowledgeSource(scopedDb, {
        workspaceId: params.workspaceId,
        type: "website",
        title: url,
        sourceLocation: url,
      });
      created.push(source);
    }
    return { sources: created, skipped: alreadyExists };
  });

  // Sequential, not Promise.all/fire-and-forget-all-at-once: each
  // background job makes a real network fetch and a paid embedding-API
  // call. Firing up to MAX_URLS_PER_SUBMISSION of those concurrently
  // risked bursting the embedding provider's rate limits in one
  // submission - the same "batch sequentially, not in parallel"
  // principle already applied to per-source chunk embedding in Phase 2,
  // just also applied across sources here.
  void processSourcesSequentially(
    params.workspaceId,
    sources.map((source) => source.id),
  );

  return { sources, skipped };
}

async function processSourcesSequentially(workspaceId: string, sourceIds: string[]): Promise<void> {
  for (const sourceId of sourceIds) {
    await processKnowledgeSource(workspaceId, sourceId).catch(() => {});
  }
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
    if (!source) {
      throw new Error("Knowledge source not found.");
    }

    let content = source.content;

    // Website sources are inserted with content: null (see
    // createKnowledgeSourcesFromUrls) - the fetch happens here, in the
    // background step, not before insert, because unlike a file upload
    // it's a network call that can be slow or fail. A real <title>
    // found on the page replaces the URL placeholder set at creation.
    if (source.type === "website" && !content) {
      if (!source.sourceLocation) {
        throw new Error("Website source has no URL to fetch.");
      }
      const extracted = await fetchAndExtractWebsiteText(source.sourceLocation);
      // Narrowing on `content` doesn't survive a property access inside
      // the closure below - pin the extracted text to its own const
      // first, same pattern as createKnowledgeSource's type-guard note.
      const extractedText = extracted.text;
      content = extractedText;
      await withWorkspaceContext(workspaceId, (scopedDb) =>
        updateKnowledgeSourceContent(scopedDb, workspaceId, sourceId, {
          ...(extracted.title ? { title: extracted.title } : {}),
          content: extractedText,
        }),
      );
    }

    if (!content) {
      throw new Error("Knowledge source has no content to process.");
    }

    const chunks = source.type === "faq" ? chunkFaqContent(content) : chunkText(content);
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
