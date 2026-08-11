import { randomBytes, createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { dbEnv } from "../src/env.js";
import { workspaceSignupInvites } from "../src/schema/index.js";

/**
 * The "simple internal way to generate invite links" for the invite-only
 * signup gate (docs/07's "Invite-Only Workspace Signup" entry) - not an
 * admin UI, deliberately. Run by whoever's onboarding a design partner;
 * runs as the migrations/superuser connection (same as migrate.ts), which
 * owns the table and so isn't affected by RLS - no special grants needed
 * for this one-off INSERT the way auth_resolver's read/claim path needed
 * them.
 *
 * Usage: pnpm --filter @csa/db invite <email> [expiresInDays=14]
 */
const DEFAULT_EXPIRY_DAYS = 14;
const DEFAULT_BASE_URL = "http://localhost:3000";

async function main() {
  const [rawEmail, rawDays] = process.argv.slice(2);
  if (!rawEmail) {
    console.error("Usage: pnpm --filter @csa/db invite <email> [expiresInDays=14]");
    process.exit(1);
  }
  const email = rawEmail.trim().toLowerCase();
  const expiresInDays = rawDays ? Number(rawDays) : DEFAULT_EXPIRY_DAYS;
  if (!Number.isFinite(expiresInDays) || expiresInDays <= 0) {
    console.error(`Invalid expiresInDays: "${rawDays}"`);
    process.exit(1);
  }

  // Same shape as apps/api/src/modules/auth/signup-invite-token.ts -
  // duplicated rather than imported across the package boundary for ten
  // lines of stdlib crypto (this script can't reach into apps/api, and
  // apps/api can't easily reach a packages/db-local script either).
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const pool = new Pool({ connectionString: dbEnv.MIGRATIONS_DATABASE_URL });
  const db = drizzle(pool, { schema: { workspaceSignupInvites } });

  await db.insert(workspaceSignupInvites).values({ email, tokenHash, expiresAt });
  await pool.end();

  const baseUrl = process.env.SIGNUP_BASE_URL ?? DEFAULT_BASE_URL;
  const link = `${baseUrl}/signup?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(email)}`;

  console.log(`Invite created for ${email}, expires ${expiresAt.toISOString()} (${expiresInDays}d).\n`);
  console.log(`Link:  ${link}`);
  console.log(`Token: ${rawToken}`);
}

main().catch((error) => {
  console.error("Could not create signup invite:", error);
  process.exit(1);
});
