import { randomBytes, createHash } from "node:crypto";

const KEY_PREFIX_LENGTH = 12;

export function generateApiKey(): { rawKey: string; keyPrefix: string; keyHash: string } {
  const rawKey = `csa_live_${randomBytes(32).toString("hex")}`;
  return {
    rawKey,
    keyPrefix: rawKey.slice(0, KEY_PREFIX_LENGTH),
    keyHash: hashApiKey(rawKey),
  };
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

// Reduces either a full origin ("https://example.com") or a bare
// hostname ("example.com") to just the hostname, lowercased - hostname
// only, deliberately not scheme/port: this is a domain allowlist, not a
// port-specific one, matching how comparable products (Intercom, Crisp)
// scope their widget domain restrictions. Used both when an owner sets
// `allowed_origins` at key-creation time and when requireApiKey
// normalizes an incoming request's Origin header, so creation-time input
// and request-time comparison always agree on the same shape. Returns
// null for anything that doesn't parse as a URL, rather than throwing -
// a malformed entry should be dropped, not crash key creation, and a
// malformed incoming Origin header should fail the allowlist check, not
// crash the request.
export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}
