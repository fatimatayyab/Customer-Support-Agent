import { sql } from "drizzle-orm";
import { index, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

// Only a salted hash of the key is ever stored. keyPrefix is a short,
// non-secret identifier (e.g. "csa_live_ab12") shown in the dashboard so
// an owner can tell keys apart without ever seeing the full secret again.
//
// This table has one access path that RLS cannot cover: resolving an
// incoming widget request's raw API key into a workspace_id happens
// BEFORE the request has a tenant context. That lookup goes through the
// separate `auth_resolver` Postgres role (BYPASSRLS, SELECT-only, granted
// in the migration below) instead of the normal app_user path - see
// packages/db/src/auth-resolver-client.ts. Every other access (the
// dashboard listing/revoking a workspace's own keys) goes through
// app_user and is fully tenant-isolated by the policy below.
export const workspaceApiKeys = pgTable(
  "workspace_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // key_hash is a plain SHA-256 digest, not a slow password hash - the
    // key itself is already a high-entropy random secret, so a fast,
    // uniquely-indexed hash is the correct (and standard) lookup strategy.
    uniqueIndex("workspace_api_keys_hash_unique").on(table.keyHash),
    // Every RLS policy and every app-layer query filters on workspace_id -
    // without this, listing/revoking a workspace's own keys is a full
    // table scan once other workspaces have keys too.
    index("workspace_api_keys_workspace_id_idx").on(table.workspaceId),
    pgPolicy("workspace_api_keys_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
