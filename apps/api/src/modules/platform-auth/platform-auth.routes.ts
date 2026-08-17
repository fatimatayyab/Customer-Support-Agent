import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { platformLogIn } from "./platform-auth.service.js";
import { requirePlatformSession } from "./require-platform-session.js";
import { PLATFORM_SESSION_COOKIE_NAME, setPlatformSessionCookie } from "./platform-session-token.js";

const platformLogInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// IP-keyed, same shape and limit as /auth/login (auth.routes.ts) - no
// tenant/workspace context applies here, and a platform-admin credential
// is at least as sensitive to credential-stuffing as a workspace one.
const PLATFORM_AUTH_RATE_LIMIT = { max: 10, timeWindow: "10 minutes" };

// Deliberately no signup route - platform admin accounts are bootstrapped
// via pnpm platform-admin:create only (see packages/db/scripts), never
// self-service.
export async function platformAuthRoutes(app: FastifyInstance) {
  app.post(
    "/platform/login",
    { config: { rateLimit: PLATFORM_AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const body = platformLogInSchema.parse(request.body);
      const { token, session } = await platformLogIn(body);
      setPlatformSessionCookie(reply, token);
      reply.send({ platformAdmin: session });
    },
  );

  app.post("/platform/logout", async (_request, reply) => {
    reply.clearCookie(PLATFORM_SESSION_COOKIE_NAME, { path: "/" });
    reply.code(204).send();
  });

  app.get("/platform/me", { preHandler: requirePlatformSession }, async (request, reply) => {
    reply.send({ platformAdmin: request.platformAdmin });
  });
}
