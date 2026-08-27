import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WorkspaceRole } from "@csa/shared";
import { requireRole } from "../auth/require-role.js";
import { requireSession } from "../auth/require-session.js";
import {
  connectHubspot,
  disconnectIntegration,
  listWorkspaceIntegrations,
  setAiToolCallingEnabled,
} from "./integration.service.js";

const connectHubspotSchema = z.object({
  accessToken: z.string().min(1),
});

const setAiToolCallingSchema = z.object({
  enabled: z.boolean(),
});

// Same tier as API key and knowledge-base management - connecting an
// integration means storing a credential that can act on the business's
// behalf, an Administrator-level responsibility per 04_Domain_Model.md.
const MANAGE_INTEGRATIONS_ROLES: WorkspaceRole[] = ["owner", "administrator"];

// Dashboard-facing: session-cookie authenticated, same as workspace.routes.ts
// and knowledge.routes.ts.
export async function integrationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);

  app.post("/integrations/hubspot/connect", async (request, reply) => {
    requireRole(
      request.sessionUser!.role,
      MANAGE_INTEGRATIONS_ROLES,
      "Only Owners and Administrators can manage integrations.",
    );
    const body = connectHubspotSchema.parse(request.body);
    const integration = await connectHubspot(request.workspaceId!, body.accessToken);
    reply.code(201).send({
      integration: {
        id: integration.id,
        provider: integration.provider,
        status: integration.status,
        lastVerifiedAt: integration.lastVerifiedAt,
      },
    });
  });

  app.get("/integrations", async (request, reply) => {
    const integrations = await listWorkspaceIntegrations(request.workspaceId!);
    reply.send({
      integrations: integrations.map((integration) => ({
        id: integration.id,
        provider: integration.provider,
        status: integration.status,
        lastVerifiedAt: integration.lastVerifiedAt,
        createdAt: integration.createdAt,
        aiToolCallingEnabled: (integration.config as { aiToolCallingEnabled?: boolean } | null)?.aiToolCallingEnabled === true,
      })),
    });
  });

  app.delete<{ Params: { id: string } }>("/integrations/:id", async (request, reply) => {
    requireRole(
      request.sessionUser!.role,
      MANAGE_INTEGRATIONS_ROLES,
      "Only Owners and Administrators can manage integrations.",
    );
    await disconnectIntegration(request.workspaceId!, request.params.id);
    reply.code(204).send();
  });

  app.patch<{ Params: { id: string } }>("/integrations/:id/ai-tool-calling", async (request, reply) => {
    requireRole(
      request.sessionUser!.role,
      MANAGE_INTEGRATIONS_ROLES,
      "Only Owners and Administrators can manage integrations.",
    );
    const body = setAiToolCallingSchema.parse(request.body);
    await setAiToolCallingEnabled(request.workspaceId!, request.params.id, body.enabled);
    reply.code(204).send();
  });
}
