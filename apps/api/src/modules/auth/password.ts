import { hash, verify } from "@node-rs/argon2";

// The library's own defaults (memoryCost 4096 = 4 MiB) are below OWASP's
// minimum recommendation. These match OWASP's Argon2id baseline
// (m=19456 KiB, t=2, p=1). verifyPassword doesn't need matching options -
// the encoded hash string carries its own parameters, so existing hashes
// created under the old defaults still verify correctly; only newly
// created hashes get the stronger settings.
const HASH_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, HASH_OPTIONS);
}

export function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  return verify(hash, plaintext);
}
