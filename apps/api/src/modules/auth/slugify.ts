import { randomBytes } from "node:crypto";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function withRandomSuffix(slug: string): string {
  return `${slug}-${randomBytes(2).toString("hex")}`;
}
