import type { FastifyInstance } from "fastify";
import { withWorkspaceContext } from "@csa/db";
import { getWorkspaceById } from "../workspaces/workspace.repository.js";
import { requireApiKey } from "./require-api-key.js";

// Widget channel: identifies the workspace from an API key, proving the
// Workspace Identification path end-to-end before any Conversation
// handling exists (that's Phase 1's Support Orchestrator work).
export async function identifyRoutes(app: FastifyInstance) {
  app.get("/widget/identify", { preHandler: requireApiKey }, async (request, reply) => {
    const workspace = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      getWorkspaceById(scopedDb, request.workspaceId!),
    );
    reply.send({ workspace: workspace ? { id: workspace.id, name: workspace.name } : null });
  });
}
