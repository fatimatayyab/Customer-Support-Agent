import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { AppError } from "../../errors.js";

// A plain function per format, not a provider interface - unlike
// AiProvider/IntegrationProvider there's no vendor to swap here, just
// which library parses which file format.

export class ExtractionFailedError extends AppError {
  constructor(type: string, detail: string) {
    super(`Could not extract text from this ${type} file: ${detail}`, 422);
  }
}

// Extraction runs synchronously in the upload request (deliberately, to
// fail fast on a corrupt file) with no worker-thread isolation - v1,
// kept minimal per instruction. A timeout is the cheap mitigation
// available without that infrastructure: it bounds how long a
// pathological file (a DOCX zip bomb, a malformed PDF) can hold up the
// request. Worth being honest about its limit - Promise.race can't
// preempt a genuinely synchronous, non-yielding CPU loop already
// blocking the event loop; it protects the common case (a slow but
// eventually-resolving extraction) and is strictly better than no bound
// at all, not a full guarantee. Full protection would need worker-thread
// isolation, explicitly deferred for v1.
const EXTRACTION_TIMEOUT_MS = 20_000;

async function withExtractionTimeout<T>(type: string, work: Promise<T>): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new ExtractionFailedError(type, `extraction took longer than ${EXTRACTION_TIMEOUT_MS / 1000}s`)),
      EXTRACTION_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  try {
    return await withExtractionTimeout(
      "pdf",
      (async () => {
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const { text } = await extractPdfText(pdf, { mergePages: true });
        return text;
      })(),
    );
  } catch (error) {
    if (error instanceof ExtractionFailedError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new ExtractionFailedError("pdf", detail);
  }
}

export async function extractDocxTextFromBuffer(buffer: Buffer): Promise<string> {
  try {
    return await withExtractionTimeout(
      "docx",
      mammoth.extractRawText({ buffer }).then((result) => result.value),
    );
  } catch (error) {
    if (error instanceof ExtractionFailedError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new ExtractionFailedError("docx", detail);
  }
}
