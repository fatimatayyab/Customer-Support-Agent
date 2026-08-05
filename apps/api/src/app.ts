import cookie from "@fastify/cookie";
import cors, { type FastifyCorsOptions } from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { env } from "./config/env.js";
import { errorHandler } from "./error-handler.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { conversationRoutes } from "./modules/conversations/conversation.routes.js";
import { integrationRoutes } from "./modules/integrations/integration.routes.js";
import { knowledgeRoutes } from "./modules/knowledge/knowledge.routes.js";
import { agentConsoleRealtimeRoutes } from "./modules/realtime/agent-console-ws.routes.js";
import { widgetRealtimeRoutes } from "./modules/realtime/widget-ws.routes.js";
import { invitationRoutes } from "./modules/users/invitation.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";
import { identifyRoutes } from "./modules/workspace-identification/identify.routes.js";
import { workspaceRoutes } from "./modules/workspaces/workspace.routes.js";

const WIDGET_ROUTE_PREFIX = "/widget";

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
  app.register(websocket);

  app.get("/health", async () => ({ status: "ok" }));

  app.register(authRoutes);
  app.register(workspaceRoutes);
  app.register(identifyRoutes);
  app.register(widgetRealtimeRoutes);
  app.register(knowledgeRoutes);
  app.register(conversationRoutes);
  app.register(agentConsoleRealtimeRoutes);
  app.register(integrationRoutes);
  app.register(userRoutes);
  app.register(invitationRoutes);

  app.setErrorHandler(errorHandler);

  return app;
}
