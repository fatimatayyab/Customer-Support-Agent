import { env } from "../../config/env.js";
import { assertDefined } from "../../assert.js";
import { AppError } from "../../errors.js";
import type { EmbeddingProvider } from "./embedding-provider.js";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3-lite";
// Conservative cap, well under Voyage's documented per-request batch
// limits for this model. A single knowledge source can chunk into far
// more texts than that (the dashboard allows up to 200k characters of
// content), so this is reachable today with one long paste, not just a
// hypothetical future PDF - splitting into sub-batches means a large
// document degrades to "slower" instead of "fails outright."
const MAX_BATCH_SIZE = 100;

// Not a customer-facing route (knowledge management is dashboard/admin
// only), so surfacing a specific, actionable message here is more
// useful than the generic 500 an unrecognized Error would collapse to.
export class EmbeddingProviderNotConfiguredError extends AppError {
  constructor() {
    super("Embeddings are not configured yet - set VOYAGE_API_KEY on the API.", 503);
  }
}

interface VoyageEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

/**
 * Voyage AI is Anthropic's own recommended embeddings pairing for RAG
 * (Claude has no embeddings API of its own). input_type differs
 * between indexing and querying - Voyage's docs note this measurably
 * improves retrieval quality over encoding both the same way, so the
 * two public methods below are intentionally not just one embed(texts).
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embed(texts, "document");
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text], "query");
    return assertDefined(embedding, "embedQuery: Voyage API returned no embeddings.");
  }

  private async embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
    if (!env.VOYAGE_API_KEY) {
      throw new EmbeddingProviderNotConfiguredError();
    }

    // Sequential, not Promise.all: bursting many concurrent requests at
    // Voyage for one large document is exactly the kind of unbounded
    // cost/rate-limit exposure worth avoiding by default, and nothing
    // here is latency-sensitive enough to justify the added risk.
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      results.push(...(await this.embedBatch(batch, inputType)));
    }
    return results;
  }

  private async embedBatch(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
    const response = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: texts, model: VOYAGE_MODEL, input_type: inputType }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Voyage embeddings request failed (${response.status}): ${body}`);
    }

    // `index` in Voyage's response is relative to this batch's own
    // input array, not a global position - safe to sort within the
    // batch and concatenate, since batches run strictly in order above.
    const result = (await response.json()) as VoyageEmbeddingResponse;
    return result.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}
