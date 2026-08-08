import * as csaDb from "@csa/db";
import { is, sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

// Schema-driven, same technique packages/db's generic tenant-isolation
// test uses to enumerate tables: iterates every exported table rather
// than hand-maintaining a name list, so a newly added table is reset
// automatically instead of silently accumulating stale rows across
// tests. TRUNCATE isn't subject to RLS (unlike SELECT/INSERT/UPDATE/
// DELETE), so this runs directly against the app_user-scoped `db`
// export with no workspace context needed.
const tableNames = (Object.values(csaDb) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => `"${getTableConfig(table).name}"`);

export async function resetDatabase(): Promise<void> {
  if (tableNames.length === 0) {
    return;
  }
  await csaDb.db.execute(sql.raw(`TRUNCATE TABLE ${tableNames.join(", ")} RESTART IDENTITY CASCADE`));
}
