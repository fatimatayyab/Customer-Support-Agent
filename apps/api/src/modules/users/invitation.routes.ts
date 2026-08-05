import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { WORKSPACE_ROLES, type WorkspaceRole } from "@csa/shared";
import { requireRole } from "../auth/require-role.js";
import { requireSession } from "../auth/require-session.js";
import { setSessionCookie } from "../auth/session-token.js";
import {
  acceptInvitation,
  createOrResendInvitation,
  getInvitationPreview,
  listWorkspaceInvitations,
  revokeWorkspaceInvitation,
} from "./invitation.service.js";

const createInvitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(WORKSPACE_ROLES),
});

const acceptInvitationSchema = z.object({
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(200),
});

const MANAGE_INVITATIONS_ROLES: WorkspaceRole[] = ["owner", "administrator"];

// Mixes session-gated management routes with public accept-flow routes
// in one plugin, same shape as auth.routes.ts (signup/login are public,
// /auth/me is gated) - per-route preHandler, not a blanket addHook,
// since a hook here would incorrectly gate the public routes too.
export async function invitationRoutes(app: FastifyInstance) {
  app.post("/workspaces/invitations", { preHandler: requireSession }, async (request, reply) => {
    requireRole(
      request.sessionUser!.role,
      MANAGE_INVITATIONS_ROLES,
      "Only Owners and Administrators can invite team members.",
    );
    const body = createInvitationSchema.parse(request.body);
    const inviter = { id: request.sessionUser!.userId, role: request.sessionUser!.role };
    const { inviteUrl, expiresAt } = await createOrResendInvitation(
      request.workspaceId!,
      inviter,
      body.email,
      body.role,
    );
    reply.code(201).send({ inviteUrl, expiresAt });
  });

  app.get("/workspaces/invitations", { preHandler: requireSession }, async (request, reply) => {
    const invitations = await listWorkspaceInvitations(request.workspaceId!);
    reply.send({ invitations });
  });

  app.delete<{ Params: { id: string } }>(
    "/workspaces/invitations/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      requireRole(
        request.sessionUser!.role,
        MANAGE_INVITATIONS_ROLES,
        "Only Owners and Administrators can revoke invitations.",
      );
      await revokeWorkspaceInvitation(request.workspaceId!, request.params.id);
      reply.code(204).send();
    },
  );

  // Public - the acceptor has no session yet. Token is the only proof of
  // identity/authorization here, same trust model as an API key or a
  // password-reset link.
  app.get<{ Params: { token: string } }>("/invitations/:token", async (request, reply) => {
    const preview = await getInvitationPreview(request.params.token);
    reply.send(preview);
  });

  app.post<{ Params: { token: string } }>("/invitations/:token/accept", async (request, reply) => {
    const body = acceptInvitationSchema.parse(request.body);
    const { token, session } = await acceptInvitation(request.params.token, body);
    setSessionCookie(reply, token);
    reply.code(201).send({ user: session });
  });
}
