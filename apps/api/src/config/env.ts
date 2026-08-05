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
  // Which AiProvider implementation the AI Service instantiates -
  // see modules/ai/ai.service.ts. Defaults to Gemini (free tier) so
  // local/dev work doesn't burn a paid Anthropic key by default;
  // switch to "anthropic" per-environment via this one variable.
  AI_PROVIDER: z.enum(["gemini", "anthropic"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Encrypts integration credentials (e.g. a HubSpot access token) at
  // rest - see modules/integrations/credential-crypto.ts. Unlike
  // SESSION_JWT_SECRET, this secret has to be decryptable back to
  // plaintext (the API calls the third-party provider with it), not just
  // verifiable, so it's a real encryption key, not a signing secret.
  INTEGRATION_CREDENTIALS_KEY: z.string().min(32),
});

export const env = envSchema.parse(process.env);
