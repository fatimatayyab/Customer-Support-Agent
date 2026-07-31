import { and, eq } from "drizzle-orm";
import { customers, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

export async function insertCustomer(scopedDb: ScopedDb, params: { workspaceId: string }) {
  const [customer] = await scopedDb.insert(customers).values(params).returning();
  return assertDefined(customer, "insertCustomer: INSERT ... RETURNING produced no row.");
}

export async function getCustomerById(scopedDb: ScopedDb, workspaceId: string, id: string) {
  const [customer] = await scopedDb
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.workspaceId, workspaceId)))
    .limit(1);
  return customer ?? null;
}
