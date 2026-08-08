import { afterAll } from "vitest";
import { pool } from "./src/client.js";

// A relative import, not `@csa/db` - that package name only resolves
// for a real consumer (apps/api), not from inside this package's own
// test run. Closes the real pg Pool client.ts opens at import time, so
// the test process exits cleanly instead of hanging on an open handle.
afterAll(async () => {
  await pool.end();
});
