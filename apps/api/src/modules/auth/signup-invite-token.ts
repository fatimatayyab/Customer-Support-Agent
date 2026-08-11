import { randomBytes, createHash } from "node:crypto";

// Deliberately not imported from modules/users/invitation-token.ts even
// though the logic is identical - that file belongs to the users/team-
// invitation module, and auth shouldn't reach across a module boundary
// for ten lines of stdlib crypto. Same shape as workspace-identification/
// api-key.ts and invitation-token.ts: an opaque random token, only its
// hash ever stored, base64url since it travels in a URL query param.
export function generateSignupInviteToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashSignupInviteToken(rawToken) };
}

export function hashSignupInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
