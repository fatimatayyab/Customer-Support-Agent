import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WorkspaceRole } from "@csa/shared";
import { requireRole } from "../auth/require-role.js";
import { requireSession } from "../auth/require-session.js";
import { getAnalyticsOverview } from "./analytics.service.js";

const overviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).default(30),
});

// Business-insight data, same tier as API keys/integrations rather than
// open to every authenticated role - a support_agent's job is handling
// the queue, not reading workspace-wide performance numbers.
const VIEW_ANALYTICS_ROLES: WorkspaceRole[] = ["owner", "administrator"];

// Dashboard-facing: session-cookie authenticated, read-only.
export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);

  app.get("/analytics/overview", async (request, reply) => {
    requireRole(request.sessionUser!.role, VIEW_ANALYTICS_ROLES, "Only Owners and Administrators can view analytics.");
    const query = overviewQuerySchema.parse(request.query);
    const overview = await getAnalyticsOverview(request.workspaceId!, query.days);
    reply.send({ overview });
  });
}
