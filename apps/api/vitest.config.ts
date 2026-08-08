import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["../../vitest.setup.ts", "./vitest.setup.ts"],
    testTimeout: 15_000,
    // Same reasoning as packages/db/vitest.config.ts - one shared
    // csa_test database, truncate-based reset between tests.
    fileParallelism: false,
  },
});
