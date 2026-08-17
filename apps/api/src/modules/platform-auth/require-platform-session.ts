import type { FastifyReply, FastifyRequest } from "fastify";
import { PLATFORM_SESSION_COOKIE_NAME, verifyPlatformSessionToken } from "./platform-session-token.js";

export async function requirePlatformSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[PLATFORM_SESSION_COOKIE_NAME];

  const session = token ? await verifyPlatformSessionToken(token) : null;

  if (!session) {
    reply.code(401).send({ error: "Not authenticated." });
    return;
  }

  request.platformAdmin = session;
}
