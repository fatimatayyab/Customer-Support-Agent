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
  // Separate from SESSION_JWT_SECRET - a platform-admin session and a
  // workspace session are structurally different identities (see
  // modules/platform-auth/), and sharing a secret would mean a leak of
  // one implies the other's blast radius.
  PLATFORM_SESSION_JWT_SECRET: z.string().min(32),
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
  // The platform's own internal escalation mirror (modules/ops/) - one
  // Airtable base/table for the whole platform, not a per-workspace
  // connection, so this is plain server config, not an encrypted
  // per-workspace credential like INTEGRATION_CREDENTIALS_KEY protects.
  // All three optional together: escalation capture works fully without
  // them (Postgres stays authoritative), the sync is just a no-op until
  // configured - same "fails gracefully but visibly" precedent
  // VOYAGE_API_KEY already sets.
  AIRTABLE_API_KEY: z.string().optional(),
  AIRTABLE_BASE_ID: z.string().optional(),
  AIRTABLE_TABLE_NAME: z.string().optional(),
  // Optional, same "fails gracefully but visibly" precedent as
  // VOYAGE_API_KEY/AIRTABLE_* above - without it, error-handler.ts's
  // catch-all branch still logs via Pino exactly as it does today, it
  // just has nowhere else to also report to.
  SENTRY_DSN: z.string().optional(),
  // Transactional email. "none" = the NullEmailSender no-op (local/dev and
  // tests - the dashboard keeps showing copy-link invites, and nothing
  // depends on a real send). "resend" = the ResendEmailSender implementation;
  // RESEND_API_KEY/EMAIL_FROM are then required (validated below). The
  // EmailSender interface is the only thing application logic depends on, so
  // swapping to SES later is a new implementation + this provider value.
  EMAIL_PROVIDER: z.enum(["resend", "none"]).default("none"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

// Cross-field validation that the flat z.object shape can't express: a
// Resend provider without its credentials is a config error that should
// fail boot loudly, not a send-time surprise.
envSchema.superRefine((values, ctx) => {
  if (values.EMAIL_PROVIDER === "resend") {
    if (!values.RESEND_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "RESEND_API_KEY is required when EMAIL_PROVIDER=resend." });
    }
    if (!values.EMAIL_FROM) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "EMAIL_FROM is required when EMAIL_PROVIDER=resend." });
    }
  }
});

export const env = envSchema.parse(process.env);
