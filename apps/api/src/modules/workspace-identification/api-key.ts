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
