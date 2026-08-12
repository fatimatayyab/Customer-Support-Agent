import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { captureEscalationContact } from "../../orchestrator/support-orchestrator.js";
import { rateLimitByWorkspace } from "../../rate-limit.js";
import { redisClient } from "../../redis-client.js";
import { requireApiKey } from "../workspace-identification/require-api-key.js";

// Loose on purpose - international phone formats vary too much for a
// strict pattern to be worth the false-reject risk, this just catches
// the "typed something into the wrong field" case (a handful of digits
// with only digit/space/dash/paren/plus characters), not a full E.164
// validator. Email gets Zod's real validator since that format is far
// less ambiguous. Without this, a customer-submitted contact_value that
// doesn't even look like the contactMethod it claims to be still gets
// stored and synced to Airtable as-is - unreachable, silently.
const captureEscalationContactSchema = z.discriminatedUnion("contactMethod", [
  z.object({
    name: z.string().min(1).max(200),
    contactMethod: z.literal("email"),
    contactValue: z.string().email().max(200),
  }),
  z.object({
    name: z.string().min(1).max(200),
    contactMethod: z.literal("phone"),
    contactValue: z
      .string()
      .max(200)
      .regex(/^\+?[\d\s()-]{7,}$/, "Enter a valid phone number."),
  }),
]);

// Widget-facing, same shape as conversation-rating.routes.ts. Workspace-
// keyed, not IP-keyed - a submission can trigger a real Airtable API
// call (via captureEscalationContact's fire-and-forget sync), the same
// "protect the workspace's own cost/abuse exposure" reasoning
// knowledge.routes.ts's ingestion limit already established.
const ESCALATION_CONTACT_RATE_LIMIT = rateLimitByWorkspace(redisClient, "escalation-contact-capture", 20, 60 * 60);

export async function conversationEscalationContactRoutes(app: FastifyInstance) {
  app.patch<{ Params: { id: string } }>(
    "/widget/conversations/:id/escalation-contact",
    { preHandler: [requireApiKey, ESCALATION_CONTACT_RATE_LIMIT] },
    async (request, reply) => {
      const body = captureEscalationContactSchema.parse(request.body);
      await captureEscalationContact(request.workspaceId!, request.params.id, body);
      reply.code(204).send();
    },
  );
}
