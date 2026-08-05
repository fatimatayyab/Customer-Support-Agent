import * as cheerio from "cheerio";
import { AppError } from "../../errors.js";

export class UnreachableUrlError extends AppError {
  constructor(detail: string) {
    super(`This URL isn't reachable: ${detail}`, 400);
  }
}

export class WebsiteFetchFailedError extends AppError {
  constructor(detail: string) {
    super(`Could not fetch this page: ${detail}`, 422);
  }
}

export class ResponseTooLargeError extends AppError {
  constructor() {
    super("Website content exceeds the maximum supported size.", 422);
  }
}

// A basic guard against pointing this server at its own internal
// network, not a complete SSRF defense (it doesn't resolve DNS to catch
// a hostname that rebinds to a private IP at fetch time - that's a
// meaningfully bigger project). Proportionate here: this endpoint is
// role-gated to owner/admin, not open to arbitrary end users, so the
// realistic risk is a mistake, not an attacker probing internal
// infrastructure through it.
function assertPubliclyReachableUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnreachableUrlError("not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnreachableUrlError("only http/https URLs are supported.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new UnreachableUrlError("local addresses aren't supported.");
  }

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    const isPrivate = a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
    if (isPrivate) {
      throw new UnreachableUrlError("private network addresses aren't supported.");
    }
  }

  return url;
}

const FETCH_TIMEOUT_MS = 15_000;

// Matches the file-upload limit (knowledge.routes.ts's
// MAX_UPLOAD_FILE_SIZE_BYTES) rather than a separately-tuned value - one
// uniform "nothing this system ingests exceeds 15MB" rule is simpler to
// reason about than two independently-justified numbers, and any
// legitimate HTML page is virtually always well under this anyway
// (real pages are typically under 1-2MB; a response actually reaching
// double digits of megabytes of raw HTML is already abnormal). Kept as
// its own constant rather than importing knowledge.routes.ts's, which
// would run the module dependency the wrong way (routes depends on this
// module, not the reverse) - the two are cross-referenced by comment
// instead.
const MAX_RESPONSE_SIZE_BYTES = 15 * 1024 * 1024;

export async function fetchAndExtractWebsiteText(rawUrl: string): Promise<{ title: string | null; text: string }> {
  const url = assertPubliclyReachableUrl(rawUrl);

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown network error";
    throw new WebsiteFetchFailedError(detail);
  }

  if (!response.ok) {
    throw new WebsiteFetchFailedError(`server responded with status ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    throw new WebsiteFetchFailedError(`expected an HTML page, got "${contentType || "unknown content type"}".`);
  }

  // Reject on a declared Content-Length before downloading anything -
  // cheapest possible check. Not trusted alone though: a server can omit
  // this header, send chunked encoding, or simply lie about it, so the
  // stream itself is still size-checked below regardless of what this
  // header claims. Checking for `null` explicitly rather than relying on
  // Number(null) === 0 happening to fall under the limit either way.
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const declaredLength = Number(contentLengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_SIZE_BYTES) {
      throw new ResponseTooLargeError();
    }
  }

  const html = await readBodyWithSizeLimit(response);
  const $ = cheerio.load(html);
  $("script, style, nav, footer, noscript").remove();

  const title = $("title").first().text().trim() || null;
  const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  const text = root
    .text()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return { title, text };
}

// Streams the body and counts bytes as they arrive, rather than calling
// response.text() and checking the result afterward - Content-Length
// (checked above) can't be trusted alone (missing, chunked encoding, or
// simply wrong), so this is the actual enforcement, not a formality.
// Cancels the underlying stream the moment the limit is crossed instead
// of continuing to download data that's just going to be discarded.
async function readBodyWithSizeLimit(response: Response): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_SIZE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ResponseTooLargeError();
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf-8");
}
