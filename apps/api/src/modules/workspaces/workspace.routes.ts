import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withWorkspaceContext } from "@csa/db";
import type { WorkspaceRole } from "@csa/shared";
import { requireRole } from "../auth/require-role.js";
import { requireSession } from "../auth/require-session.js";
import { NotFoundError } from "../../errors.js";
import { generateApiKey, normalizeOrigin } from "../workspace-identification/api-key.js";
import {
  getApiKeyById,
  hasAnyApiKeyEverExisted,
  insertApiKey,
  listActiveApiKeys,
  revokeApiKey,
} from "./api-key.repository.js";

const MAX_ALLOWED_ORIGINS = 10;

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  // Optional - omitted or empty means unrestricted, the pre-existing
  // behavior. Accepts either a bare hostname ("example.com") or a full
  // origin ("https://example.com"); normalizeOrigin() reduces either to
  // the same hostname-only shape requireApiKey compares against.
  allowedOrigins: z.array(z.string().min(1).max(253)).max(MAX_ALLOWED_ORIGINS).optional(),
});

const MANAGE_API_KEY_ROLES: WorkspaceRole[] = ["owner", "administrator"];

// Dashboard-facing: session-cookie authenticated, locked to the known
// dashboard origin (registered with restrictive CORS in app.ts).
export async function workspaceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);

  app.post("/workspaces/api-keys", async (request, reply) => {
    requireRole(request.sessionUser!.role, MANAGE_API_KEY_ROLES, "Only Owners and Administrators can manage API keys.");
    const body = createApiKeySchema.parse(request.body);
    const { rawKey, keyPrefix, keyHash } = generateApiKey();

    // Malformed entries are dropped rather than rejected outright -
    // normalizeOrigin returning null for one bad entry in a list of
    // several shouldn't fail the whole request. An empty result after
    // filtering (or no field at all) means unrestricted, same as before
    // this column existed.
    const normalizedOrigins = body.allowedOrigins
      ?.map(normalizeOrigin)
      .filter((origin): origin is string => origin !== null);
    const allowedOrigins = normalizedOrigins && normalizedOrigins.length > 0 ? normalizedOrigins : null;

    const apiKey = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      insertApiKey(scopedDb, { workspaceId: request.workspaceId!, name: body.name, keyPrefix, keyHash, allowedOrigins }),
    );

    // rawKey is only ever available in this response - only its hash is stored.
    reply.code(201).send({
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        allowedOrigins: apiKey.allowedOrigins,
        rawKey,
      },
    });
  });

  app.get("/workspaces/api-keys", async (request, reply) => {
    // everProvisioned lets the dashboard tell "never installed" (auto-
    // provision a default) apart from "installed once, then explicitly
    // removed" (don't silently recreate it) - both look identical as an
    // empty apiKeys array otherwise. Only queried when the active list is
    // actually empty - sequential, not Promise.all, since both queries
    // share the one pg client withWorkspaceContext's transaction holds.
    const result = await withWorkspaceContext(request.workspaceId!, async (scopedDb) => {
      const apiKeys = await listActiveApiKeys(scopedDb, request.workspaceId!);
      const everProvisioned = apiKeys.length > 0 || (await hasAnyApiKeyEverExisted(scopedDb, request.workspaceId!));
      return { apiKeys, everProvisioned };
    });
    reply.send(result);
  });

  // "Get a new install code" - a single action for the case that used
  // to require understanding "revoke, then create a new one with the
  // same settings." Deliberately takes no body: it exists to make
  // recovering from a lost/leaked code frictionless, not to double as a
  // way to edit a key's name/domains - changing those means creating a
  // fresh install via POST instead.
  app.post<{ Params: { id: string } }>("/workspaces/api-keys/:id/rotate", async (request, reply) => {
    requireRole(request.sessionUser!.role, MANAGE_API_KEY_ROLES, "Only Owners and Administrators can manage API keys.");

    const rotated = await withWorkspaceContext(request.workspaceId!, async (scopedDb) => {
      const existing = await getApiKeyById(scopedDb, request.workspaceId!, request.params.id);
      if (!existing || existing.revokedAt !== null) {
        return null;
      }

      await revokeApiKey(scopedDb, request.workspaceId!, existing.id);
      const { rawKey, keyPrefix, keyHash } = generateApiKey();
      const apiKey = await insertApiKey(scopedDb, {
        workspaceId: request.workspaceId!,
        name: existing.name,
        keyPrefix,
        keyHash,
        allowedOrigins: existing.allowedOrigins,
      });
      return { apiKey, rawKey };
    });

    if (!rotated) {
      throw new NotFoundError("API key not found or already revoked.");
    }

    reply.code(201).send({
      apiKey: {
        id: rotated.apiKey.id,
        name: rotated.apiKey.name,
        keyPrefix: rotated.apiKey.keyPrefix,
        allowedOrigins: rotated.apiKey.allowedOrigins,
        rawKey: rotated.rawKey,
      },
    });
  });

  app.delete<{ Params: { id: string } }>("/workspaces/api-keys/:id", async (request, reply) => {
    requireRole(request.sessionUser!.role, MANAGE_API_KEY_ROLES, "Only Owners and Administrators can manage API keys.");
    const revoked = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      revokeApiKey(scopedDb, request.workspaceId!, request.params.id),
    );

    if (!revoked) {
      reply.code(404).send({ error: "API key not found." });
      return;
    }
    reply.code(204).send();
  });
}
