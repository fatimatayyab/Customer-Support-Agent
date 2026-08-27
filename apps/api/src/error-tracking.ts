import * as Sentry from "@sentry/node";
import { env } from "./config/env.js";

// Optional - error-handler.ts's catch-all branch already logs every
// unexpected error via Pino, which is real but invisible unless someone
// is actively tailing logs. This adds a second destination, only when
// configured, without changing what happens if it isn't: no huge
// observability stack, just the one thing genuinely missing (the audit's
// "minimum observability" finding) - real-time visibility into
// unexpected errors.
export function initErrorTracking(): void {
  if (!env.SENTRY_DSN) {
    return;
  }
  Sentry.init({ dsn: env.SENTRY_DSN });
}

export function captureError(error: unknown): void {
  if (!env.SENTRY_DSN) {
    return;
  }
  Sentry.captureException(error);
}
