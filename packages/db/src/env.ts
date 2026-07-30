import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { z } from "zod";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
config({ path: resolve(repoRoot, ".env") });

const envSchema = z.object({
  MIGRATIONS_DATABASE_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  AUTH_RESOLVER_DATABASE_URL: z.string().url(),
});

export const dbEnv = envSchema.parse(process.env);
