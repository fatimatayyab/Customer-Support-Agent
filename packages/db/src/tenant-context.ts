import { sql } from "drizzle-orm";
import { db } from "./client.js";

// Inferred directly from db.transaction's own callback parameter instead
// of hand-reconstructing drizzle's schema/relations generics - guaranteed
// to match whatever `db` actually produces, even as the schema grows.
export type ScopedDb = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The single structural gate for tenant isolation. Every repository
 * function that touches a workspace-owned table must receive a ScopedDb
 * (never the raw `db` export) so there is no code path that can query
 * those tables without first committing to a workspace_id.
 *
 * set_config(..., true) sets a transaction-local Postgres session
 * variable (equivalent to SET LOCAL) which Row Level Security policies
 * read via current_setting('app.workspace_id', true). Using set_config()
 * as a function call - rather than interpolating the id into a `SET`
 * string - lets the driver bind it as a normal parameter, avoiding any
 * hand-rolled SQL-escaping for a value that flows in from request context.
 */
export async function withWorkspaceContext<T>(
  workspaceId: string,
  callback: (scopedDb: ScopedDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return callback(tx);
  });
}
