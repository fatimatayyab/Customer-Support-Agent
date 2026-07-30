import { defineConfig } from "drizzle-kit";
import { dbEnv } from "./src/env.js";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: dbEnv.MIGRATIONS_DATABASE_URL,
  },
});
