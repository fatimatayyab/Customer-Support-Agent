import { afterAll } from "vitest";

// @csa/db resolves correctly here since apps/api is a real workspace
// consumer of it - see packages/db/vitest.setup.ts for why that
// package needs a relative import instead for the identical teardown.
afterAll(async () => {
  const { pool } = await import("@csa/db");
  await pool.end();
});
