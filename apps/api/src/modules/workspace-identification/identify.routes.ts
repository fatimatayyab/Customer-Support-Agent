import type { FastifyInstance } from "fastify";
import { withWorkspaceContext } from "@csa/db";
import { DEFAULT_WIDGET_SETTINGS, getWidgetSettings } from "../workspaces/widget-settings.repository.js";
import { getWorkspaceById } from "../workspaces/workspace.repository.js";
import { requireApiKey } from "./require-api-key.js";

// Widget channel: identifies the workspace from an API key, proving the
// Workspace Identification path end-to-end before any Conversation
// handling exists (that's Phase 1's Support Orchestrator work).
export async function identifyRoutes(app: FastifyInstance) {
  app.get("/widget/identify", { preHandler: requireApiKey }, async (request, reply) => {
    // Sequential, not Promise.all - both queries share the one pg client
    // withWorkspaceContext's transaction holds, and node-postgres doesn't
    // support concurrent queries on a single client (same reasoning as
    // analytics.service.ts's getAnalyticsOverview).
    const result = await withWorkspaceContext(request.workspaceId!, async (scopedDb) => {
      const workspace = await getWorkspaceById(scopedDb, request.workspaceId!);
      if (!workspace) {
        return null;
      }
      const settings = await getWidgetSettings(scopedDb, request.workspaceId!);
      return { workspace, settings };
    });

    if (!result) {
      reply.send({ workspace: null });
      return;
    }

    reply.send({
      workspace: {
        id: result.workspace.id,
        name: result.workspace.name,
        assistantName: result.settings?.assistantName ?? DEFAULT_WIDGET_SETTINGS.assistantName,
        greetingMessage: result.settings?.greetingMessage ?? DEFAULT_WIDGET_SETTINGS.greetingMessage,
        primaryColor: result.settings?.primaryColor ?? DEFAULT_WIDGET_SETTINGS.primaryColor,
        position: result.settings?.position ?? DEFAULT_WIDGET_SETTINGS.position,
        avatarUrl: result.settings?.avatarUrl ?? DEFAULT_WIDGET_SETTINGS.avatarUrl,
      },
    });
  });
}
