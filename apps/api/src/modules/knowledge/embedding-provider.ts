/**
 * Abstraction over whatever embeds text into vectors, mirroring the
 * PRS's "AI provider-independent" stance for the generation layer -
 * Voyage AI is the concrete choice today (see voyage-embedding-provider.ts),
 * but nothing outside this module should import that class directly.
 */
export interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
