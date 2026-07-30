import { hash, verify } from "@node-rs/argon2";

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext);
}

export function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  return verify(hash, plaintext);
}
