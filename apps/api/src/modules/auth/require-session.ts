import type { FastifyReply, FastifyRequest } from "fastify";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session-token.js";

export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[SESSION_COOKIE_NAME];

  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    reply.code(401).send({ error: "Not authenticated." });
    return;
  }

  request.sessionUser = session;
  request.workspaceId = session.workspaceId;
}
