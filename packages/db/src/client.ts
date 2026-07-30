import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { dbEnv } from "./env.js";
import * as schema from "./schema/index.js";

// Connects as app_user (NOSUPERUSER / NOBYPASSRLS). Every query issued
// through this pool is subject to Row Level Security. There is no
// unscoped query path exposed from this module - use
// withWorkspaceContext() from tenant-context.ts to get a scoped client.
export const pool = new Pool({ connectionString: dbEnv.DATABASE_URL });

export const db = drizzle(pool, { schema });

export type Database = typeof db;
