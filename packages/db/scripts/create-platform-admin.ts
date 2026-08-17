import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { dbEnv } from "../src/env.js";
import { platformAdmins } from "../src/schema/index.js";

/**
 * Bootstraps a Platform Admin account - the one piece of this feature
 * that stays CLI-only, permanently. Everything else the Platform Owner
 * Dashboard needs (provisioning workspaces, suspending clients) is
 * self-service once at least one platform admin exists; getting the
 * FIRST one into existence is the same chicken-and-egg problem
 * create-signup-invite.ts already solves for the first workspace - runs
 * as the migrations/superuser connection (owns the table, unaffected by
 * RLS), same as migrate.ts and create-signup-invite.ts.
 *
 * Usage: pnpm --filter @csa/db platform-admin:create <email> <name>
 */
async function main() {
  const [rawEmail, name] = process.argv.slice(2);
  if (!rawEmail || !name) {
    console.error("Usage: pnpm --filter @csa/db platform-admin:create <email> <name>");
    process.exit(1);
  }
  const email = rawEmail.trim().toLowerCase();

  // A random temp password, shown once - same "copy this now" contract
  // as a generated API key or workspace-signup-invite link. There's no
  // self-service password change in V1; whoever bootstraps this account
  // is expected to log in immediately and treat the printed value as the
  // real credential going forward.
  const tempPassword = randomBytes(18).toString("base64url");
  const passwordHash = await hash(tempPassword);

  const pool = new Pool({ connectionString: dbEnv.MIGRATIONS_DATABASE_URL });
  const db = drizzle(pool, { schema: { platformAdmins } });

  await db.insert(platformAdmins).values({ email, name, passwordHash });
  await pool.end();

  console.log(`Platform admin created for ${email}.\n`);
  console.log(`Email:    ${email}`);
  console.log(`Password: ${tempPassword}`);
  console.log(`\nCopy this now - it won't be shown again. Log in at /platform/login.`);
}

main().catch((error) => {
  console.error("Could not create platform admin:", error);
  process.exit(1);
});
