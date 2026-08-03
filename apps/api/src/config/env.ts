import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { z } from "zod";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
config({ path: resolve(repoRoot, ".env") });

const envSchema = z.object({
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  DASHBOARD_ORIGIN: z.string().url(),
  SESSION_JWT_SECRET: z.string().min(32),
  REDIS_URL: z.string().url(),
  // Optional so the API can boot without it - ingestion/search requests
  // fail with a clear "not configured" error until it's set, rather
  // than the whole app refusing to start over a feature not yet in use.
  VOYAGE_API_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);
