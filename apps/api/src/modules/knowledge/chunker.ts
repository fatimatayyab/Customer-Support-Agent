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

// The "faq" source type has existed since Phase 2 but was never chunked
// any differently from plain text - the generic character-count
// splitter above doesn't know a question and its answer belong in the
// same chunk, so one could land split across a boundary. This pairs
// consecutive blank-line-separated blocks whenever the first looks like
// a question (ends in "?", or a "Q:"/"Q." prefix) and the second
// doesn't - each pair becomes its own chunk, keeping question and
// answer together regardless of length.
export function chunkFaqContent(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const looksLikeQuestion = (paragraph: string) => /\?\s*$/.test(paragraph) || /^q[:.)]/i.test(paragraph);

  const chunks: string[] = [];
  let recognizedPairs = 0;
  let i = 0;
  while (i < paragraphs.length) {
    const current = paragraphs[i];
    const next = paragraphs[i + 1];
    if (current === undefined) {
      break;
    }
    if (looksLikeQuestion(current) && next !== undefined && !looksLikeQuestion(next)) {
      chunks.push(`${current}\n\n${next}`);
      recognizedPairs += 1;
      i += 2;
    } else {
      chunks.push(current);
      i += 1;
    }
  }

  // Nothing here actually looked like a Q/A pair - this content doesn't
  // match the shape this function assumes, so fall back to the generic
  // chunker rather than forcing a split that doesn't apply. Graceful
  // degradation, not a hard failure.
  if (recognizedPairs === 0) {
    return chunkText(text);
  }

  return chunks;
}
