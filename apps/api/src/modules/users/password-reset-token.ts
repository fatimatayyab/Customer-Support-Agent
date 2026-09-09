import { randomBytes, createHash } from "node:crypto";

// Mirrors invitation-token.ts / api-key.ts: an opaque high-entropy random
// token, only its SHA-256 hash ever stored, so "consume" is just marking
// used_at rather than needing a stateful blocklist. base64url (not hex)
// since this value travels directly in a URL query param.
export function generatePasswordResetToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashPasswordResetToken(rawToken) };
}

export function hashPasswordResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}