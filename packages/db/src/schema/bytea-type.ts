import { customType } from "drizzle-orm/pg-core";

/**
 * Drizzle has no first-class `bytea` column type as of this version, so
 * this defines one via customType - the same approach vector-type.ts
 * takes for pgvector. Values move as Buffers on the wire: node-postgres
 * serializes a Buffer to a bytea literal and deserializes a bytea column
 * back to a Buffer with no extra type registration needed.
 */
export const byteaType = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return value as unknown as Buffer;
  },
});