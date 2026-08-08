import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * One-time, idempotent local bootstrap for the test database. Mirrors
 * exactly what infra/postgres/init/01-app-role.sql does for csa_dev,
 * applied to a second, separate database (csa_test) instead - so a
 * test run can never read or overwrite real dev data, while reusing
 * the same app_user/auth_resolver roles (those are cluster-wide, not
 * per-database, so they already exist).
 *
 * Safe to re-run: CREATE DATABASE is guarded by an existence check
 * (Postgres has no CREATE DATABASE IF NOT EXISTS), every GRANT is
 * idempotent by nature, and drizzle's migrator only applies migrations
 * it hasn't already recorded as applied.
 *
 * Run via `pnpm --filter @csa/db test:db:setup` before running tests
 * for the first time, or after a new migration is added.
 */
const ADMIN_URL = process.env.TEST_DB_ADMIN_URL ?? "postgres://postgres:postgres_dev_password@localhost:5433/csa_dev";
const TEST_DB_NAME = "csa_test";
const TEST_DB_URL = deriveTestDbUrl(ADMIN_URL);

function deriveTestDbUrl(adminUrl: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

async function main() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (rowCount === 0) {
    // Can't run inside a transaction and can't parameterize an
    // identifier - TEST_DB_NAME is a fixed literal above, not
    // user input, so this is safe.
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
    console.log(`Created database ${TEST_DB_NAME}.`);
  } else {
    console.log(`Database ${TEST_DB_NAME} already exists.`);
  }
  await admin.end();

  const testDb = new Client({ connectionString: TEST_DB_URL });
  await testDb.connect();
  await testDb.query("CREATE EXTENSION IF NOT EXISTS vector");
  await testDb.query(`GRANT CONNECT ON DATABASE ${TEST_DB_NAME} TO app_user`);
  await testDb.query(`GRANT CONNECT ON DATABASE ${TEST_DB_NAME} TO auth_resolver`);
  await testDb.query("GRANT USAGE ON SCHEMA public TO app_user");
  await testDb.query("GRANT USAGE ON SCHEMA public TO auth_resolver");
  await testDb.query("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user");
  await testDb.query("GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user");
  await testDb.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO app_user");
  await testDb.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO app_user");
  await testDb.end();

  // Runs as the same postgres superuser production migrations use, for
  // the same reason migrate.ts does - it must own every table it
  // creates for RLS to apply without FORCE ROW LEVEL SECURITY.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./migrations" });
  await pool.end();

  console.log(`${TEST_DB_NAME} is ready and migrated.`);
}

main().catch((error) => {
  console.error("Test DB setup failed:", error);
  process.exit(1);
});
