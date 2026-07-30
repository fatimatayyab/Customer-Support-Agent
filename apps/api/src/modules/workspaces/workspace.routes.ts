import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withWorkspaceContext } from "@csa/db";
import { ForbiddenError } from "../../errors.js";
import { requireSession } from "../auth/require-session.js";
import { generateApiKey } from "../workspace-identification/api-key.js";
import { insertApiKey, listActiveApiKeys, revokeApiKey } from "./api-key.repository.js";

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
});

const MANAGE_API_KEY_ROLES = new Set(["owner", "administrator"]);

// Dashboard-facing: session-cookie authenticated, locked to the known
// dashboard origin (registered with restrictive CORS in app.ts).
export async function workspaceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);

  app.post("/workspaces/api-keys", async (request, reply) => {
    requireManageApiKeysRole(request.sessionUser!.role);
    const body = createApiKeySchema.parse(request.body);
    const { rawKey, keyPrefix, keyHash } = generateApiKey();

    const apiKey = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      insertApiKey(scopedDb, { workspaceId: request.workspaceId!, name: body.name, keyPrefix, keyHash }),
    );

    // rawKey is only ever available in this response - only its hash is stored.
    reply.code(201).send({ apiKey: { id: apiKey.id, name: apiKey.name, keyPrefix: apiKey.keyPrefix, rawKey } });
  });

  app.get("/workspaces/api-keys", async (request, reply) => {
    const apiKeys = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      listActiveApiKeys(scopedDb, request.workspaceId!),
    );
    reply.send({ apiKeys });
  });

  app.delete<{ Params: { id: string } }>("/workspaces/api-keys/:id", async (request, reply) => {
    requireManageApiKeysRole(request.sessionUser!.role);
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

function requireManageApiKeysRole(role: string): void {
  if (!MANAGE_API_KEY_ROLES.has(role)) {
    throw new ForbiddenError("Only Owners and Administrators can manage API keys.");
  }
}
