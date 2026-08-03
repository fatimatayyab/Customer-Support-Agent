import { customType } from "drizzle-orm/pg-core";

/**
 * Drizzle has no first-class pgvector column type as of this version,
 * so this defines one via customType - the standard approach until
 * native support lands. Values move as bracketed text ("[0.1,0.2,...]")
 * on the wire, which is exactly the literal format pgvector's own input
 * function accepts, so no special driver-level type registration is
 * needed.
 */
export const vector = customType<{ data: number[]; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 512})`;
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    const raw = value as unknown as string;
    return raw
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});
