import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePlatformSession } from "../platform-auth/require-platform-session.js";
import {
  createWorkspaceInvite,
  getWorkspaceDetail,
  listWorkspaceInvites,
  listWorkspaces,
  reactivateWorkspace,
  revokeWorkspaceApiKey,
  revokeWorkspaceInvite,
  suspendWorkspace,
  updateWorkspaceMeta,
} from "./platform.service.js";

const createInviteSchema = z.object({
  email: z.string().email(),
  expiresInDays: z.number().int().positive().max(90).optional(),
});

const updateMetaSchema = z.object({
  plan: z.string().max(100).nullable(),
  billingNotes: z.string().max(2000).nullable(),
});

// Every route here is platform-admin-authenticated, cross-tenant by
// design - this is the one part of the system deliberately allowed to
// see/act across every workspace, gated by requirePlatformSession
// (a completely separate identity/cookie from a workspace session, see
// modules/platform-auth/) rather than requireSession + a role check.
export async function platformRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requirePlatformSession);

  app.get("/platform/workspaces", async (_request, reply) => {
    const workspaces = await listWorkspaces();
    reply.send({ workspaces });
  });

  app.get<{ Params: { id: string } }>("/platform/workspaces/:id", async (request, reply) => {
    const detail = await getWorkspaceDetail(request.params.id);
    reply.send(detail);
  });

  app.post<{ Params: { id: string } }>("/platform/workspaces/:id/suspend", async (request, reply) => {
    const workspace = await suspendWorkspace(request.platformAdmin!.platformAdminId, request.params.id);
    reply.send({ workspace });
  });

  app.post<{ Params: { id: string } }>("/platform/workspaces/:id/reactivate", async (request, reply) => {
    const workspace = await reactivateWorkspace(request.platformAdmin!.platformAdminId, request.params.id);
    reply.send({ workspace });
  });

  app.patch<{ Params: { id: string } }>("/platform/workspaces/:id/meta", async (request, reply) => {
    const body = updateMetaSchema.parse(request.body);
    const meta = await updateWorkspaceMeta(request.platformAdmin!.platformAdminId, request.params.id, body);
    reply.send({ meta });
  });

  app.post<{ Params: { id: string; keyId: string } }>(
    "/platform/workspaces/:id/api-keys/:keyId/revoke",
    async (request, reply) => {
      await revokeWorkspaceApiKey(request.platformAdmin!.platformAdminId, request.params.id, request.params.keyId);
      reply.code(204).send();
    },
  );

  app.post("/platform/workspace-invites", async (request, reply) => {
    const body = createInviteSchema.parse(request.body);
    const { inviteUrl, expiresAt } = await createWorkspaceInvite(request.platformAdmin!.platformAdminId, body);
    reply.code(201).send({ inviteUrl, expiresAt });
  });

  app.get("/platform/workspace-invites", async (_request, reply) => {
    const invites = await listWorkspaceInvites();
    reply.send({ invites });
  });

  app.delete<{ Params: { id: string } }>("/platform/workspace-invites/:id", async (request, reply) => {
    await revokeWorkspaceInvite(request.platformAdmin!.platformAdminId, request.params.id);
    reply.code(204).send();
  });
}
