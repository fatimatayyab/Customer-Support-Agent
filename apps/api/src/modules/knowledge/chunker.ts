// Character-based, not token-based - a simple proxy that avoids pulling
// in a tokenizer dependency. Paragraph-aware: prefers to break on blank
// lines so a chunk doesn't split mid-thought unless a single paragraph
// itself exceeds the target size, in which case it's hard-split.
const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 100;

export function chunkText(
  text: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_CHUNK_OVERLAP,
): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= chunkSize) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = current.slice(Math.max(0, current.length - overlap));
    }

    if (paragraph.length <= chunkSize) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    } else {
      // A single paragraph longer than the target chunk size - hard-split it.
      for (let i = 0; i < paragraph.length; i += chunkSize - overlap) {
        chunks.push(paragraph.slice(i, i + chunkSize));
      }
      current = "";
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
