import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { dbEnv } from "./env.js";

// Runs as the postgres superuser so it owns every table it creates. That
// ownership is what lets Row Level Security apply automatically to
// app_user / auth_resolver without needing FORCE ROW LEVEL SECURITY.
async function main() {
  const pool = new Pool({ connectionString: dbEnv.MIGRATIONS_DATABASE_URL });
  const db = drizzle(pool);

  await migrate(db, { migrationsFolder: "./migrations" });

  await pool.end();
  console.log("Migrations applied.");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
