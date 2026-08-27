import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { dbEnv } from "./env.js";
import * as schema from "./schema/index.js";

// Connects as app_user (NOSUPERUSER / NOBYPASSRLS). Every query issued
// through this pool is subject to Row Level Security. There is no
// unscoped query path exposed from this module - use
// withWorkspaceContext() from tenant-context.ts to get a scoped client.
// max: 10 is node-postgres's own default - set explicitly (not left
// implicit) since this is one of four separate pools this process opens
// (see auth-resolver-client.ts, platform-operator-client.ts), and this
// one carries by far the most traffic (every normal tenant-scoped
// query), so it's the one most worth being deliberate about.
export const pool = new Pool({ connectionString: dbEnv.DATABASE_URL, max: 10 });

export const db = drizzle(pool, { schema });

export type Database = typeof db;
