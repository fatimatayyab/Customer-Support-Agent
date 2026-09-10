import { AppError } from "../../errors.js";

export const MAX_ATTACHMENT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 6;

// The complete allowlist of file types a customer may attach. Deliberately
// excludes anything executable/scriptable (html, svg, js...) - an uploaded
// file is stored and re-served with the Content-Type below plus
// X-Content-Type-Options: nosniff, so the only types that may ever render
// inline in a browser are the raster image formats. The doc types are
// allowed as "a human may need to open the document the customer is
// talking about" but are served as downloads, never rendered.
export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

// Types that are safe to render inline in a chat bubble (images).
export const INLINE_RENDERABLE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

// The image/pdf types have a reliable magic-number signature; text/doc
// types do not. A file whose *declared* type is sniffable but whose bytes
// don't match is rejected outright - not "trusted because it says so".
const SNIFFABLE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

function sniffMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  if (buffer.length >= 5 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46 && buffer[4] === 0x2d) {
    return "application/pdf";
  }
  return null;
}

function sanitizeFilename(filename: string): string {
  // Display-only value - strip any path components, control characters,
  // and cap its length so a hostile name can't be used as anything but
  // text. "..", leading dots, and reserved names are fine to keep: the
  // file is served from a DB row via an id-keyed URL, never from a
  // filesystem path derived from this value.
  return filename.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
}

export interface ValidatedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  data: Buffer;
}

// The single server-side validation gate every upload goes through:
// size (checked both here and by the multipart plugin's own limit),
// declared-type-vs-magic-number consistency for sniffable types, and the
// allowlist. Returns the normalized attachment; throws a client-safe
// AppError on any rejection.
export function validateAndNormalizeAttachment(
  declaredMimeType: string,
  rawFilename: string,
  buffer: Buffer,
): ValidatedAttachment {
  const mimeType = declaredMimeType.split(";")[0]!.trim().toLowerCase();
  const filename = sanitizeFilename(rawFilename);

  if (buffer.length === 0) {
    throw new AppError("The uploaded file is empty.", 400);
  }
  if (buffer.length > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
    throw new AppError(`Files must be ${MAX_ATTACHMENT_FILE_SIZE_BYTES / (1024 * 1024)}MB or smaller.`, 400);
  }
  if (!filename) {
    throw new AppError("The uploaded file has no name.", 400);
  }

  const sniffed = sniffMimeType(buffer);
  let effectiveType: string;
  if (sniffed) {
    effectiveType = sniffed;
  } else if (SNIFFABLE_TYPES.has(mimeType)) {
    // Claimed to be an image/PDF but the bytes aren't - rejected rather
    // than stored under a Content-Type that doesn't describe the content.
    throw new AppError("The uploaded file's contents do not match its type.", 400);
  } else {
    effectiveType = mimeType;
  }

  if (!ALLOWED_MIME_TYPES.has(effectiveType)) {
    throw new AppError("This file type isn't supported. Please attach an image, PDF, or text/document file.", 400);
  }

  return { filename, mimeType: effectiveType, size: buffer.length, data: buffer };
}