import { createHash } from "node:crypto";
import { CompactEncrypt, compactDecrypt } from "jose";
import { env } from "../../config/env.js";

/**
 * Encrypts integration credentials at rest using jose's JWE support
 * (direct symmetric key, A256GCM) rather than hand-rolled AES/IV/tag
 * bookkeeping - jose is already a trusted dependency here for exactly
 * this reason (see session-token.ts's comment on not hand-writing
 * security-critical crypto). This is a different problem from session
 * tokens: a session JWT only ever needs to be *verified*, never read
 * back to plaintext; a stored credential has to be decrypted again to
 * actually call the provider.
 *
 * A256GCM's "dir" key management requires exactly 32 bytes. Rather than
 * asking every environment to hand-generate a base64-encoded 32-byte
 * value precisely, INTEGRATION_CREDENTIALS_KEY is any string >= 32
 * chars (same shape as SESSION_JWT_SECRET) and this module deterministically
 * derives a 32-byte key from it via SHA-256.
 */
const key = createHash("sha256").update(env.INTEGRATION_CREDENTIALS_KEY).digest();

export async function encryptCredentials(plaintext: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(plaintext));
  return new CompactEncrypt(bytes).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).encrypt(key);
}

export async function decryptCredentials<T = Record<string, unknown>>(jwe: string): Promise<T> {
  const { plaintext } = await compactDecrypt(jwe, key);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
