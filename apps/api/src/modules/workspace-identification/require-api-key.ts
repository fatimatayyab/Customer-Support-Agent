import type { FastifyReply, FastifyRequest } from "fastify";
import { findApiKeyByHash, touchApiKeyLastUsed } from "@csa/db";
import { hashApiKey, normalizeOrigin } from "./api-key.js";

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

  // Null/empty allowedOrigins = unrestricted, the default and the only
  // behavior that existed before this column - existing keys keep
  // working exactly as they do today. When an owner has opted into
  // restricting a key, a request with no Origin header (or one that
  // doesn't parse) fails closed rather than being treated as
  // unrestricted: a real browser widget making a cross-origin
  // fetch/WebSocket-handshake call always sends Origin, so its absence
  // here is itself a signal something isn't a normal embed.
  if (apiKey.allowedOrigins && apiKey.allowedOrigins.length > 0) {
    const origin = request.headers.origin;
    const hostname = typeof origin === "string" ? normalizeOrigin(origin) : null;
    if (!hostname || !apiKey.allowedOrigins.includes(hostname)) {
      reply.code(401).send({ error: "Invalid API key." });
      return;
    }
  }

  request.workspaceId = apiKey.workspaceId;

  // Un-awaited: this is a display-only "last used" timestamp, not part
  // of the auth decision itself - no reason to add latency to every
  // widget request waiting on it.
  touchApiKeyLastUsed(apiKey.id).catch((error) => request.log.error(error, "touchApiKeyLastUsed failed"));
}
