import { Redis } from "ioredis";
import { env } from "./config/env.js";

/**
 * REDIS_URL has been provisioned since Phase 0 (env.ts, docker-compose.yml)
 * but nothing has actually connected to it - reserved for the real-time
 * hub once it runs across more than one API instance (see
 * modules/realtime/conversation-hub.ts). Rate limiting is the first real
 * consumer: a shared, already-running Redis instance is exactly the
 * right place for request counters that need to be correct regardless
 * of how many API instances end up handling a given client's requests.
 */
export const redisClient = new Redis(env.REDIS_URL);
