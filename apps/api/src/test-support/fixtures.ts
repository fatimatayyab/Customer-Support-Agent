import { randomUUID } from "node:crypto";
import { withWorkspaceContext, type ScopedDb } from "@csa/db";
import type { WorkspaceRole } from "@csa/shared";
import { insertConversation } from "../modules/conversations/conversation.repository.js";
import { insertCustomer } from "../modules/customers/customer.repository.js";
import { insertUser } from "../modules/users/user.repository.js";
import { insertWorkspace } from "../modules/workspaces/workspace.repository.js";

/**
 * Thin builders over the real repository functions, not hand-written
 * SQL - dogfooding the same code path production uses to create these
 * rows, so a fixture can't silently drift from what insertWorkspace/
 * insertUser/etc. actually require. Each one runs inside its own
 * withWorkspaceContext call, matching how every real caller creates
 * these rows - no test-only shortcut around tenant scoping.
 */

// passwordHash is never a real Argon2 hash here - nothing in this
// module ever verifies a login, and hashing a value nobody checks
// would only slow tests down for no benefit.
const FIXTURE_PASSWORD_HASH = "fixture-not-a-real-hash";

export async function createWorkspace(overrides: Partial<{ name: string; slug: string }> = {}) {
  const id = randomUUID();
  const suffix = id.slice(0, 8);
  return withWorkspaceContext(id, (scopedDb) =>
    insertWorkspace(scopedDb, {
      id,
      name: overrides.name ?? `Test Workspace ${suffix}`,
      slug: overrides.slug ?? `test-workspace-${suffix}`,
    }),
  );
}

export async function createUser(
  workspaceId: string,
  overrides: Partial<{ email: string; name: string; role: WorkspaceRole }> = {},
) {
  const suffix = randomUUID().slice(0, 8);
  return withWorkspaceContext(workspaceId, (scopedDb) =>
    insertUser(scopedDb, {
      workspaceId,
      email: overrides.email ?? `user-${suffix}@example.test`,
      passwordHash: FIXTURE_PASSWORD_HASH,
      name: overrides.name ?? `Test User ${suffix}`,
      role: overrides.role ?? "owner",
    }),
  );
}

export async function createCustomer(workspaceId: string) {
  return withWorkspaceContext(workspaceId, (scopedDb) => insertCustomer(scopedDb, { workspaceId }));
}

export async function createConversation(workspaceId: string, customerId?: string) {
  const resolvedCustomerId = customerId ?? (await createCustomer(workspaceId)).id;
  return withWorkspaceContext(workspaceId, (scopedDb) =>
    insertConversation(scopedDb, { workspaceId, customerId: resolvedCustomerId }),
  );
}

/**
 * A full, ready-to-use workspace + owner + customer + conversation, for
 * tests whose actual focus is downstream of all that setup (most
 * Orchestrator tests). Returns a callback so a test can still reach
 * into a specific piece via a plain ScopedDb of its own if needed.
 */
export async function createConversationScenario() {
  const workspace = await createWorkspace();
  const user = await createUser(workspace.id);
  const customer = await createCustomer(workspace.id);
  const conversation = await createConversation(workspace.id, customer.id);
  return { workspace, user, customer, conversation };
}

export type { ScopedDb };
