import type { EmbeddingProvider } from "../modules/knowledge/embedding-provider.js";

/**
 * Returns the same fixed, deterministic vector for anything it embeds -
 * unlike FakeAiProvider, there's no meaningfully "wrong" default here
 * to guard against, so this doesn't need mock*()-before-use ceremony.
 * A test that needs "nothing relevant retrieved" should seed no
 * knowledge chunks for that workspace rather than fight this fake's
 * vector math - simpler, and it's what searchKnowledge naturally
 * returns an empty array for regardless of embedding content.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimensions = 512) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map(() => this.vector());
  }

  async embedQuery(): Promise<number[]> {
    return this.vector();
  }

  private vector(): number[] {
    return Array.from({ length: this.dimensions }, (_, index) => (index === 0 ? 1 : 0));
  }
}
