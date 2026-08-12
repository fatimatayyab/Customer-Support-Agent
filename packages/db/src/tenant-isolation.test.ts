import { randomUUID } from "node:crypto";
import { eq, is, sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "./client.js";
import * as schema from "./schema/index.js";
import { EMBEDDING_DIMENSIONS } from "./schema/knowledge-chunks.js";
import { withWorkspaceContext, type ScopedDb } from "./tenant-context.js";

/**
 * The foundation-level tenant-isolation guarantee: for every table that
 * declares a workspace_id column, a row inserted under workspace A is
 * genuinely invisible when read back under workspace B's context - not
 * just "the app code happens to filter by workspace_id somewhere," but
 * that Postgres's RLS policy itself enforces it.
 *
 * Deliberately schema-driven rather than one hand-written test per
 * table: this iterates every exported table with a workspace_id column
 * and requires a `fixtures` entry for each one. Add a new tenant table
 * without registering a fixture here, and this suite fails loudly
 * ("No fixture registered for...") instead of silently shipping that
 * table with zero isolation coverage - the exact failure mode that let
 * a missing index slip through unnoticed for two phases (docs/07).
 * This can't fully synthesize a valid row for an arbitrary table
 * without knowing its specific required columns, so each table still
 * gets one short, explicit fixture - what it removes is the ability to
 * *forget* one, not the need to write it.
 */

function must<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

async function resetDatabase(): Promise<void> {
  const tableNames = (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => `"${getTableConfig(table).name}"`);
  if (tableNames.length === 0) {
    return;
  }
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableNames.join(", ")} RESTART IDENTITY CASCADE`));
}

async function insertMinimalWorkspace(id: string) {
  return withWorkspaceContext(id, async (scopedDb) => {
    const [workspace] = await scopedDb
      .insert(schema.workspaces)
      .values({ id, name: `Fixture Workspace ${id.slice(0, 8)}`, slug: `fixture-${id}` })
      .returning();
    return must(workspace, "insertMinimalWorkspace: INSERT ... RETURNING produced no row.");
  });
}

async function insertMinimalUser(scopedDb: ScopedDb, workspaceId: string) {
  const [user] = await scopedDb
    .insert(schema.users)
    .values({
      workspaceId,
      email: `user-${randomUUID()}@example.test`,
      passwordHash: "fixture-hash",
      name: "Fixture User",
      role: "owner",
    })
    .returning();
  return must(user, "insertMinimalUser: INSERT ... RETURNING produced no row.");
}

async function insertMinimalCustomer(scopedDb: ScopedDb, workspaceId: string) {
  const [customer] = await scopedDb.insert(schema.customers).values({ workspaceId }).returning();
  return must(customer, "insertMinimalCustomer: INSERT ... RETURNING produced no row.");
}

async function insertMinimalConversation(scopedDb: ScopedDb, workspaceId: string) {
  const customer = await insertMinimalCustomer(scopedDb, workspaceId);
  const [conversation] = await scopedDb
    .insert(schema.conversations)
    .values({ workspaceId, customerId: customer.id })
    .returning();
  return must(conversation, "insertMinimalConversation: INSERT ... RETURNING produced no row.");
}

async function insertMinimalKnowledgeSource(scopedDb: ScopedDb, workspaceId: string) {
  const [source] = await scopedDb
    .insert(schema.knowledgeSources)
    .values({ workspaceId, type: "plain_text", title: "Fixture Source" })
    .returning();
  return must(source, "insertMinimalKnowledgeSource: INSERT ... RETURNING produced no row.");
}

async function insertMinimalIntegration(scopedDb: ScopedDb, workspaceId: string) {
  const [integration] = await scopedDb
    .insert(schema.integrations)
    .values({ workspaceId, provider: "hubspot", credentials: "fixture-credentials" })
    .returning();
  return must(integration, "insertMinimalIntegration: INSERT ... RETURNING produced no row.");
}

type FixtureRow = { id: string };
type FixtureBuilder = (scopedDb: ScopedDb, workspaceId: string) => Promise<FixtureRow>;

// Keyed by the actual Postgres table name (matches getTableConfig(table).name),
// not the JS export name - one entry per tenant table.
const fixtures: Record<string, FixtureBuilder> = {
  users: (scopedDb, workspaceId) => insertMinimalUser(scopedDb, workspaceId),

  workspace_api_keys: async (scopedDb, workspaceId) => {
    const [key] = await scopedDb
      .insert(schema.workspaceApiKeys)
      .values({ workspaceId, name: "Fixture Key", keyPrefix: "fx_test", keyHash: randomUUID() })
      .returning();
    return must(key, "workspace_api_keys fixture: INSERT ... RETURNING produced no row.");
  },

  customers: (scopedDb, workspaceId) => insertMinimalCustomer(scopedDb, workspaceId),

  conversations: (scopedDb, workspaceId) => insertMinimalConversation(scopedDb, workspaceId),

  messages: async (scopedDb, workspaceId) => {
    const conversation = await insertMinimalConversation(scopedDb, workspaceId);
    const [message] = await scopedDb
      .insert(schema.messages)
      .values({ workspaceId, conversationId: conversation.id, senderType: "customer", content: "hi" })
      .returning();
    return must(message, "messages fixture: INSERT ... RETURNING produced no row.");
  },

  conversation_notes: async (scopedDb, workspaceId) => {
    const conversation = await insertMinimalConversation(scopedDb, workspaceId);
    const user = await insertMinimalUser(scopedDb, workspaceId);
    const [note] = await scopedDb
      .insert(schema.conversationNotes)
      .values({ workspaceId, conversationId: conversation.id, userId: user.id, content: "note" })
      .returning();
    return must(note, "conversation_notes fixture: INSERT ... RETURNING produced no row.");
  },

  knowledge_sources: (scopedDb, workspaceId) => insertMinimalKnowledgeSource(scopedDb, workspaceId),

  knowledge_chunks: async (scopedDb, workspaceId) => {
    const source = await insertMinimalKnowledgeSource(scopedDb, workspaceId);
    const [chunk] = await scopedDb
      .insert(schema.knowledgeChunks)
      .values({
        workspaceId,
        knowledgeSourceId: source.id,
        content: "chunk",
        embedding: new Array(EMBEDDING_DIMENSIONS).fill(0),
        chunkOrder: 0,
      })
      .returning();
    return must(chunk, "knowledge_chunks fixture: INSERT ... RETURNING produced no row.");
  },

  integrations: (scopedDb, workspaceId) => insertMinimalIntegration(scopedDb, workspaceId),

  integration_action_logs: async (scopedDb, workspaceId) => {
    const user = await insertMinimalUser(scopedDb, workspaceId);
    const [log] = await scopedDb
      .insert(schema.integrationActionLogs)
      .values({
        workspaceId,
        actionName: "test-action",
        resultStatus: "success",
        resultSummary: "ok",
        triggeredByUserId: user.id,
      })
      .returning();
    return must(log, "integration_action_logs fixture: INSERT ... RETURNING produced no row.");
  },

  conversation_ratings: async (scopedDb, workspaceId) => {
    const conversation = await insertMinimalConversation(scopedDb, workspaceId);
    const [rating] = await scopedDb
      .insert(schema.conversationRatings)
      .values({ workspaceId, conversationId: conversation.id, rating: "up" })
      .returning();
    return must(rating, "conversation_ratings fixture: INSERT ... RETURNING produced no row.");
  },

  conversation_escalation_contacts: async (scopedDb, workspaceId) => {
    const conversation = await insertMinimalConversation(scopedDb, workspaceId);
    const [contact] = await scopedDb
      .insert(schema.conversationEscalationContacts)
      .values({
        workspaceId,
        conversationId: conversation.id,
        name: "Fixture Customer",
        contactMethod: "email",
        contactValue: "fixture@example.test",
        escalationReason: "customer_requested_human",
      })
      .returning();
    return must(contact, "conversation_escalation_contacts fixture: INSERT ... RETURNING produced no row.");
  },

  invitations: async (scopedDb, workspaceId) => {
    const user = await insertMinimalUser(scopedDb, workspaceId);
    const [invitation] = await scopedDb
      .insert(schema.invitations)
      .values({
        workspaceId,
        email: `invite-${randomUUID()}@example.test`,
        role: "support_agent",
        tokenHash: randomUUID(),
        invitedByUserId: user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning();
    return must(invitation, "invitations fixture: INSERT ... RETURNING produced no row.");
  },
};

const tenantTables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .filter((table) => getTableConfig(table).columns.some((column) => column.name === "workspace_id"));

describe("Row-Level Security: generic per-table tenant isolation", () => {
  afterEach(async () => {
    await resetDatabase();
  });

  for (const table of tenantTables) {
    const tableName = getTableConfig(table).name;

    it(`blocks workspace B from reading workspace A's row in "${tableName}"`, async () => {
      const buildRow = fixtures[tableName];
      if (!buildRow) {
        throw new Error(
          `No fixture registered for tenant table "${tableName}" in tenant-isolation.test.ts - ` +
            "add one to the `fixtures` map so this table's RLS policy is actually verified.",
        );
      }

      const workspaceAId = randomUUID();
      const workspaceBId = randomUUID();
      await insertMinimalWorkspace(workspaceAId);
      await insertMinimalWorkspace(workspaceBId);

      const row = await withWorkspaceContext(workspaceAId, (scopedDb) => buildRow(scopedDb, workspaceAId));

      const idColumn = must(
        getTableConfig(table).columns.find((column) => column.name === "id"),
        `Table "${tableName}" has no "id" column - can't build a generic RLS check for it.`,
      );

      const rowsVisibleToWorkspaceA = await withWorkspaceContext(workspaceAId, (scopedDb) =>
        scopedDb.select().from(table).where(eq(idColumn, row.id)),
      );
      expect(rowsVisibleToWorkspaceA).toHaveLength(1);

      const rowsVisibleToWorkspaceB = await withWorkspaceContext(workspaceBId, (scopedDb) =>
        scopedDb.select().from(table).where(eq(idColumn, row.id)),
      );
      expect(rowsVisibleToWorkspaceB).toHaveLength(0);
    });
  }
});

// workspaces itself isn't part of the generic loop above (it has no
// workspace_id column - it IS the tenant root, isolated via its own id
// against app.workspace_id instead). Its policy is structurally
// different (insert is open, since there's no context yet at creation
// time) so it gets its own direct check rather than a fixtures entry.
describe("Row-Level Security: workspaces table", () => {
  afterEach(async () => {
    await resetDatabase();
  });

  it("blocks workspace B from reading workspace A's own workspace row", async () => {
    const workspaceAId = randomUUID();
    const workspaceBId = randomUUID();
    await insertMinimalWorkspace(workspaceAId);
    await insertMinimalWorkspace(workspaceBId);

    const visibleToA = await withWorkspaceContext(workspaceAId, (scopedDb) => scopedDb.select().from(schema.workspaces));
    expect(visibleToA).toHaveLength(1);
    expect(visibleToA[0]?.id).toBe(workspaceAId);

    const visibleToB = await withWorkspaceContext(workspaceBId, (scopedDb) => scopedDb.select().from(schema.workspaces));
    expect(visibleToB).toHaveLength(1);
    expect(visibleToB[0]?.id).toBe(workspaceBId);
  });
});
