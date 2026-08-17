import type { FastifyReply, FastifyRequest } from "fastify";
import { findApiKeyByHash } from "@csa/db";
import { hashApiKey } from "./api-key.js";

/**
 * Workspace Identification for the widget channel: resolves the
 * X-API-Key header to a workspace_id before any further processing.
 * Every future communication channel (WhatsApp, email, ...) gets its own
 * identification strategy living next to this one, per the System
 * Architecture's "Workspace Identification" component - none of them
 * touch the Support Orchestrator until a workspace_id is attached.
 */
export async function requireApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const rawKey = request.headers["x-api-key"];

  if (typeof rawKey !== "string" || rawKey.length === 0) {
    reply.code(401).send({ error: "Missing API key." });
    return;
  }

  const apiKey = await findApiKeyByHash(hashApiKey(rawKey));

  if (!apiKey || apiKey.revokedAt !== null) {
    reply.code(401).send({ error: "Invalid API key." });
    return;
  }

  // A suspended workspace (Platform Owner Dashboard's Suspend action)
  // must stop widget traffic, not just dashboard logins - otherwise a
  // suspended client's embedded widget keeps calling paid AI endpoints
  // indefinitely, defeating the whole point of suspending them.
  if (apiKey.workspaceStatus !== "active") {
    reply.code(401).send({ error: "Invalid API key." });
    return;
  }

  request.workspaceId = apiKey.workspaceId;
}
