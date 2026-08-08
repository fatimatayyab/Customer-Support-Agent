import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { rateConversation } from "../../orchestrator/support-orchestrator.js";
import { requireApiKey } from "../workspace-identification/require-api-key.js";

const rateConversationSchema = z.object({ rating: z.enum(["up", "down"]) });

// Widget-facing: API-key authenticated, like widget-ws.routes.ts's
// POST /widget/session - a plain REST call, not routed through the
// WebSocket protocol, since a rating isn't a live event anything else
// needs to react to. The /widget prefix matters beyond routing: app.ts's
// CORS delegator branches on it to grant open-origin, no-credentials
// CORS (the widget runs on arbitrary third-party sites) instead of the
// dashboard's locked-to-DASHBOARD_ORIGIN policy.
export async function conversationRatingRoutes(app: FastifyInstance) {
  app.patch<{ Params: { id: string } }>(
    "/widget/conversations/:id/rating",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const body = rateConversationSchema.parse(request.body);
      await rateConversation(request.workspaceId!, request.params.id, body.rating);
      reply.code(204).send();
    },
  );
}
