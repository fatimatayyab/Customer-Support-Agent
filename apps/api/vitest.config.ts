import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["../../vitest.setup.ts", "./vitest.setup.ts"],
    testTimeout: 15_000,
    // TRUNCATE of every tenant table between tests takes several seconds
    // on a loaded Docker-on-Windows dev box (measured >10s under load) -
    // the default 10s hook timeout is flaky here, so DB-reset hooks get a
    // generous, explicit one. Widens only how long a reset may take; test
    // assertions themselves keep their normal timeouts.
    hookTimeout: 60_000,
    // Same reasoning as packages/db/vitest.config.ts - one shared
    // csa_test database, truncate-based reset between tests.
    fileParallelism: false,
  },
});
