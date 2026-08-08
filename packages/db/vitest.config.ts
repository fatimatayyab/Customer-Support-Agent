import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["../../vitest.setup.ts", "./vitest.setup.ts"],
    testTimeout: 15_000,
    // Tests in this package share one real csa_test database and reset
    // it (truncate) between tests rather than using per-test isolated
    // transactions - see docs/07 for why. Running multiple test files
    // in parallel would let one file's reset race another file's
    // in-flight assertions against the same tables. Revisit only if
    // suite runtime becomes a real, measured problem - not preemptively.
    fileParallelism: false,
  },
});
