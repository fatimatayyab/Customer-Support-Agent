import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors, { type FastifyCorsOptions } from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import websocket from "@fastify/websocket";
import fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { pool } from "@csa/db";
import { env } from "./config/env.js";
import { errorHandler } from "./error-handler.js";
import { redisClient } from "./redis-client.js";
import { RateLimitExceededError } from "./rate-limit.js";
import { analyticsRoutes } from "./modules/analytics/analytics.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { conversationEscalationContactRoutes } from "./modules/conversations/conversation-escalation-contact.routes.js";
import { conversationRatingRoutes } from "./modules/conversations/conversation-rating.routes.js";
import { conversationRoutes } from "./modules/conversations/conversation.routes.js";
import { integrationRoutes } from "./modules/integrations/integration.routes.js";
import { knowledgeRoutes } from "./modules/knowledge/knowledge.routes.js";
import { agentConsoleRealtimeRoutes } from "./modules/realtime/agent-console-ws.routes.js";
import { widgetRealtimeRoutes } from "./modules/realtime/widget-ws.routes.js";
import { invitationRoutes } from "./modules/users/invitation.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";
import { identifyRoutes } from "./modules/workspace-identification/identify.routes.js";
import { workspaceRoutes } from "./modules/workspaces/workspace.routes.js";
import { widgetSettingsRoutes } from "./modules/workspaces/widget-settings.routes.js";
import { platformAuthRoutes } from "./modules/platform-auth/platform-auth.routes.js";
import { platformRoutes } from "./modules/platform/platform.routes.js";

const WIDGET_ROUTE_PREFIX = "/widget";

// The single built widget bundle (apps/widget's `pnpm build` output) -
// served directly off this API rather than a separate CDN/static host,
// since none exists yet (see docs/07's "Widget Production Hosting" gap).
// Reusing the one public tunnel/domain this API already needs for
// widget/AI traffic means a real external customer's embed only ever
// depends on one host, not two. Revisit this the moment a real static
// host is decided - this is a minimal stand-in, not the final answer.
const WIDGET_DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../widget/dist");

// A single cors registration with a per-request delegate, rather than
// registering the plugin twice: @fastify/cors installs one global
// wildcard OPTIONS route for preflight handling, which collides if the
// plugin is registered more than once on the same Fastify instance.
function corsOptionsFor(request: FastifyRequest): FastifyCorsOptions {
  if (request.url.startsWith(WIDGET_ROUTE_PREFIX)) {
    // Widget requests authenticate via X-API-Key header, not cookies, and
    // the widget is embedded on arbitrary third-party sites the platform
    // doesn't control in advance - open CORS, no credentials, is correct.
    return { origin: true, credentials: false };
  }

  // Dashboard requests use an httpOnly session cookie and must be locked
  // to the known dashboard origin.
  return { origin: env.DASHBOARD_ORIGIN, credentials: true };
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger: {
      transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
    },
  });

  // Deliberately not awaiting individual register() calls here: the
  // fastify instance register() returns is thenable, and awaiting it
  // triggers an implicit ready()/boot right then - which would lock in
  // whatever's registered so far and silently skip everything below,
  // including setErrorHandler. A single boot happens later, when
  // server.ts calls app.listen().
  app.register(cookie);
  app.register(cors, {
    delegator: (request, callback) => {
      callback(null, corsOptionsFor(request));
    },
  });
  // maxPayload caps a single raw WS frame - without it, a client could
  // send an arbitrarily large frame that costs memory/CPU to buffer and
  // JSON.parse before Zod's own per-field limits (message content 4000
  // chars, pageUrl 2048, pageTitle 300 - widget-ws.routes.ts) ever get a
  // chance to reject it. 32KB comfortably covers the largest legitimate
  // message:send payload with room for JSON overhead and multi-byte
  // UTF-8 expansion.
  app.register(websocket, { options: { maxPayload: 32 * 1024 } });
  // No auth, no CORS restriction (script tags aren't subject to CORS
  // anyway) - a widget loader script is meant to be publicly fetchable
  // by design, same as any real CDN-hosted widget. WIDGET_DIST_DIR only
  // ever contains the one built widget.js, never source or secrets.
  app.register(staticFiles, { root: WIDGET_DIST_DIR });
  // A generous, IP-keyed default across every route - the real
  // protection for cost-incurring/abuse-prone endpoints (auth,
  // knowledge ingestion, invitations, WS messages) is the tighter,
  // workspace-keyed limits registered per-route below and in
  // rate-limit.ts; this is the floor everything else gets for free.
  // Backed by the shared Redis instance (redis-client.ts) so the limit
  // holds correctly if this ever runs as more than one API instance.
  app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    redis: redisClient,
    nameSpace: "csa-rl-global-",
    // The plugin's own default throws a plain Error carrying only
    // `.statusCode` (no `.code`) - error-handler.ts's Fastify-error
    // branch deliberately only trusts errors with an `FST_`-prefixed
    // code (a past fix, after a third-party SDK's own unrelated
    // `statusCode` field nearly leaked through that same branch), so a
    // plain Error here would silently collapse to a generic 500 instead
    // of a 429. Returning our own AppError subclass instead routes it
    // through the existing, already-correct AppError branch - no need
    // to broaden error-handler.ts itself.
    errorResponseBuilder: () => new RateLimitExceededError(),
  });

  // Deliberately checks DB and Redis connectivity, not just "the process
  // is alive" - both are hard runtime dependencies (every request needs
  // RLS-scoped Postgres; the global rate limiter needs Redis), so a host's
  // health check should catch a broken connection to either, not just a
  // process that's up but non-functional.
  app.get("/health", async (_request, reply) => {
    const [dbResult, redisResult] = await Promise.allSettled([pool.query("SELECT 1"), redisClient.ping()]);
    const healthy = dbResult.status === "fulfilled" && redisResult.status === "fulfilled";
    reply.code(healthy ? 200 : 503);
    return {
      status: healthy ? "ok" : "degraded",
      db: dbResult.status === "fulfilled" ? "ok" : "unreachable",
      redis: redisResult.status === "fulfilled" ? "ok" : "unreachable",
    };
  });

  app.register(authRoutes);
  app.register(workspaceRoutes);
  app.register(widgetSettingsRoutes);
  app.register(identifyRoutes);
  app.register(widgetRealtimeRoutes);
  app.register(knowledgeRoutes);
  app.register(conversationRoutes);
  app.register(conversationRatingRoutes);
  app.register(conversationEscalationContactRoutes);
  app.register(agentConsoleRealtimeRoutes);
  app.register(integrationRoutes);
  app.register(userRoutes);
  app.register(invitationRoutes);
  app.register(analyticsRoutes);
  app.register(platformAuthRoutes);
  app.register(platformRoutes);

  app.setErrorHandler(errorHandler);

  return app;
}
