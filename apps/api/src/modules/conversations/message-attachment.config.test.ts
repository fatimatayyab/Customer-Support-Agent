import { describe, expect, it } from "vitest";
import { AppError } from "../../errors.js";
import {
  ALLOWED_MIME_TYPES,
  INLINE_RENDERABLE_TYPES,
  MAX_ATTACHMENT_FILE_SIZE_BYTES,
  validateAndNormalizeAttachment,
} from "./message-attachment.config.js";

function pngBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
}

function pdfBuffer(): Buffer {
  return Buffer.from("%PDF-1.7 fake pdf bytes");
}

describe("validateAndNormalizeAttachment", () => {
  it("accepts a real PNG and returns its sniffed type, size, and a cleaned filename", () => {
    const result = validateAndNormalizeAttachment("image/png", "screenshot.png", pngBuffer());
    expect(result.mimeType).toBe("image/png");
    expect(result.size).toBe(pngBuffer().length);
    expect(result.filename).toBe("screenshot.png");
    expect(result.data).toEqual(pngBuffer());
  });

  it("accepts a PDF and sniffs it as application/pdf", () => {
    const result = validateAndNormalizeAttachment("application/octet-stream", "policy.pdf", pdfBuffer());
    expect(result.mimeType).toBe("application/pdf");
  });

  it("accepts a non-sniffable allowlisted type (text/plain) based on its declared type", () => {
    const result = validateAndNormalizeAttachment("text/plain", "notes.txt", Buffer.from("hello"));
    expect(result.mimeType).toBe("text/plain");
  });

  it("accepts an uppercase/MIME-parameterized declared type by normalizing it", () => {
    const result = validateAndNormalizeAttachment("Image/PNG", "a.png", pngBuffer());
    expect(result.mimeType).toBe("image/png");
  });

  it("rejects a type outside the allowlist", () => {
    expect(() => validateAndNormalizeAttachment("text/html", "page.html", Buffer.from("<html></html>"))).toThrow(AppError);
  });

  it("rejects a sniffable declared type whose bytes don't match (html named as png)", () => {
    expect(() => validateAndNormalizeAttachment("image/png", "evil.png", Buffer.from("<html>"))).toThrow(
      /do not match its type/,
    );
  });

  it("rejects an empty file", () => {
    expect(() => validateAndNormalizeAttachment("text/plain", "empty.txt", Buffer.alloc(0))).toThrow(/empty/);
  });

  it("rejects a file over the size cap", () => {
    const oversized = Buffer.alloc(MAX_ATTACHMENT_FILE_SIZE_BYTES + 1);
    expect(() => validateAndNormalizeAttachment("image/png", "big.png", oversized)).toThrow(/5MB/);
  });

  it("strips path components and control characters from the filename", () => {
    const result = validateAndNormalizeAttachment("text/plain", "..\\evil\u0000.txt", Buffer.from("x"));
    expect(result.filename).toBe("evil.txt");
  });

  it("rejects a file with no usable name", () => {
    expect(() => validateAndNormalizeAttachment("text/plain", "/", Buffer.from("x"))).toThrow(/no name/);
  });

  it("exposes the exact allowlist and inline-renderable sets the routes depend on", () => {
    expect(ALLOWED_MIME_TYPES.has("image/svg+xml")).toBe(false);
    expect(INLINE_RENDERABLE_TYPES.has("image/webp")).toBe(true);
    expect(INLINE_RENDERABLE_TYPES.has("application/pdf")).toBe(false);
  });
});