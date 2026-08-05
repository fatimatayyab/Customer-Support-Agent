import { randomBytes, createHash } from "node:crypto";

// Mirrors workspace-identification/api-key.ts's shape: an opaque random
// token, only its hash ever stored, so revoking is just flipping a
// status flag rather than needing a stateful blocklist. base64url (not
// hex) since this value travels directly in a URL query param.
export function generateInvitationToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashInvitationToken(rawToken) };
}

export function hashInvitationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
