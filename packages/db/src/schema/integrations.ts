import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

// One value today (hubspot) - declared as an enum rather than free text
// because "which vendor" is a closed, known set at any point in time,
// same reasoning as knowledge_sources' source-type enum. Unlike that
// enum, there's no approved upfront list to declare ahead of support for -
// add a value here only when a provider actually gets implemented.
export const integrationProviderEnum = pgEnum("integration_provider", ["hubspot"]);

export const integrationStatusEnum = pgEnum("integration_status", ["connected", "error", "disconnected"]);

// Represents one workspace's connection to one external business system
// (04_Domain_Model.md's Integration entity). `credentials` is a compact
// JWE string (packages: jose, see credential-crypto.ts) - encrypted, not
// hashed, because the API has to decrypt it back to plaintext to actually
// call the provider. Never selected into any route response.
export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    // Non-secret, provider-specific config (e.g. a shop domain for a
    // future e-commerce provider) - empty for HubSpot today, where a
    // private-app access token alone identifies the account.
    config: jsonb("config").notNull().default({}),
    credentials: text("credentials").notNull(),
    status: integrationStatusEnum("status").notNull().default("connected"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("integrations_workspace_id_idx").on(table.workspaceId),
    // One active connection per provider per workspace - no concept of
    // multiple simultaneous HubSpot connections needed yet.
    uniqueIndex("integrations_workspace_id_provider_unique").on(table.workspaceId, table.provider),
    pgPolicy("integrations_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
