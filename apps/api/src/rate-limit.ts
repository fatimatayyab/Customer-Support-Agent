import type { Redis } from "ioredis";
import type { FastifyRequest } from "fastify";
import { AppError } from "./errors.js";

export class RateLimitExceededError extends AppError {
  constructor(message = "Too many requests. Please try again shortly.") {
    super(message, 429);
  }
}

/**
 * A fixed-window counter (INCR, with EXPIRE set only on the first
 * increment in a window) - the standard, simplest correct primitive for
 * this, backed by the shared Redis instance (redis-client.ts) rather
 * than an in-memory counter, so the limit is correct regardless of how
 * many API instances end up handling a given workspace's requests.
 *
 * Written as a small explicit function rather than routed through
 * @fastify/rate-limit's per-route `hook` timing option: the keys this
 * needs (workspaceId, conversationId) aren't known until after an auth
 * preHandler has already run, and an explicit INCR/EXPIRE call is
 * simpler to reason about than configuring a plugin's hook-ordering
 * behavior for that case. @fastify/rate-limit itself is still used
 * directly (app.ts, auth.routes.ts) for the ordinary IP-keyed cases,
 * where its default timing is exactly right.
 */
export async function checkRateLimit(redis: Redis, key: string, max: number, windowSeconds: number): Promise<void> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  if (count > max) {
    throw new RateLimitExceededError();
  }
}

/**
 * A preHandler factory for REST routes - register it *after* whatever
 * preHandler populates request.workspaceId (requireSession/requireApiKey),
 * not as a blanket plugin-level hook, so the key is always real by the
 * time this runs.
 */
export function rateLimitByWorkspace(redis: Redis, action: string, max: number, windowSeconds: number) {
  return async function rateLimitPreHandler(request: FastifyRequest): Promise<void> {
    const workspaceId = request.workspaceId;
    if (!workspaceId) {
      // No tenant context yet - nothing to key on. The auth preHandler
      // this always runs after already rejects an unauthenticated
      // request on its own; this isn't a bypass.
      return;
    }
    await checkRateLimit(redis, `rl:${action}:${workspaceId}`, max, windowSeconds);
  };
}
