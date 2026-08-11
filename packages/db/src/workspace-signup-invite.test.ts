import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { claimWorkspaceSignupInvite, findWorkspaceSignupInviteByTokenHash } from "./auth-resolver-client.js";
import { db } from "./client.js";
import { dbEnv } from "./env.js";
import { workspaceSignupInvites } from "./schema/index.js";

// workspace_signup_invites has no app_user-writable path at all (see the
// schema file's own comment - RLS enabled, zero policies, deliberately).
// Fixture rows here are created the same way the real
// create-signup-invite.ts script creates them: via the migrations/
// superuser connection, which owns the table and isn't subject to RLS.
const adminPool = new Pool({ connectionString: dbEnv.MIGRATIONS_DATABASE_URL });
const adminDb = drizzle(adminPool, { schema: { workspaceSignupInvites } });

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

async function insertTestInvite(overrides: { email?: string; expiresAt?: Date; usedAt?: Date | null } = {}) {
  const rawToken = randomUUID();
  const tokenHash = hashToken(rawToken);
  await adminDb.insert(workspaceSignupInvites).values({
    email: overrides.email ?? "invitee@example.test",
    tokenHash,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    usedAt: overrides.usedAt ?? null,
  });
  return { rawToken, tokenHash };
}

beforeAll(async () => {
  await adminPool.query("SELECT 1");
});

afterEach(async () => {
  await db.execute(sql.raw("TRUNCATE TABLE workspace_signup_invites RESTART IDENTITY CASCADE"));
});

afterAll(async () => {
  await adminPool.end();
});

describe("findWorkspaceSignupInviteByTokenHash", () => {
  it("returns null for an unknown token", async () => {
    const result = await findWorkspaceSignupInviteByTokenHash(hashToken("does-not-exist"));
    expect(result).toBeNull();
  });

  it("returns the invite for a known token", async () => {
    const { tokenHash } = await insertTestInvite({ email: "someone@example.test" });
    const result = await findWorkspaceSignupInviteByTokenHash(tokenHash);
    expect(result?.email).toBe("someone@example.test");
    expect(result?.usedAt).toBeNull();
  });
});

describe("claimWorkspaceSignupInvite", () => {
  it("claims a valid, unexpired, unused invite", async () => {
    const { tokenHash } = await insertTestInvite();

    const claimed = await claimWorkspaceSignupInvite(tokenHash);

    expect(claimed).toBe(true);
    const after = await findWorkspaceSignupInviteByTokenHash(tokenHash);
    expect(after?.usedAt).not.toBeNull();
  });

  it("refuses to claim an already-used invite", async () => {
    const { tokenHash } = await insertTestInvite({ usedAt: new Date() });

    const claimed = await claimWorkspaceSignupInvite(tokenHash);

    expect(claimed).toBe(false);
  });

  it("refuses to claim an expired invite", async () => {
    const { tokenHash } = await insertTestInvite({ expiresAt: new Date(Date.now() - 1000) });

    const claimed = await claimWorkspaceSignupInvite(tokenHash);

    expect(claimed).toBe(false);
  });

  it("refuses to claim an unknown token", async () => {
    const claimed = await claimWorkspaceSignupInvite(hashToken("never-issued"));
    expect(claimed).toBe(false);
  });

  // The actual single-use guarantee: two requests racing to claim the
  // same invite must not both succeed. This is what makes the atomic
  // conditional UPDATE the real guard rather than the earlier read-only
  // lookup - a naive "check then write" would let both of these through.
  it("lets exactly one of two concurrent claims for the same invite succeed", async () => {
    const { tokenHash } = await insertTestInvite();

    const [first, second] = await Promise.all([claimWorkspaceSignupInvite(tokenHash), claimWorkspaceSignupInvite(tokenHash)]);

    const successCount = [first, second].filter(Boolean).length;
    expect(successCount).toBe(1);
  });
});
