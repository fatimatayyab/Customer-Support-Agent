import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WorkspaceRole } from "@csa/shared";
import { requireRole } from "../auth/require-role.js";
import { requireSession } from "../auth/require-session.js";
import { createKnowledgeSource, listSources, removeKnowledgeSource, searchKnowledge } from "./knowledge.service.js";

const createSourceSchema = z.object({
  type: z.enum(["plain_text", "faq"]),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(200_000),
});

const searchSchema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(20).optional(),
});

// Same tier as API key management - knowledge configuration is an
// Administrator-level responsibility per 04_Domain_Model.md. Search
// stays open to every authenticated role (including support_agent):
// it's read-only, and agents plausibly want it to help answer
// customers themselves.
const MANAGE_KNOWLEDGE_ROLES: WorkspaceRole[] = ["owner", "administrator"];

// Dashboard-facing: session-cookie authenticated, same as workspace.routes.ts.
export async function knowledgeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);

  app.post("/knowledge/sources", async (request, reply) => {
    requireRole(
      request.sessionUser!.role,
      MANAGE_KNOWLEDGE_ROLES,
      "Only Owners and Administrators can manage the knowledge base.",
    );
    const body = createSourceSchema.parse(request.body);
    const source = await createKnowledgeSource({ workspaceId: request.workspaceId!, ...body });
    reply.code(201).send({ source });
  });

  app.get("/knowledge/sources", async (request, reply) => {
    const sources = await listSources(request.workspaceId!);
    reply.send({ sources });
  });

  app.delete<{ Params: { id: string } }>("/knowledge/sources/:id", async (request, reply) => {
    requireRole(
      request.sessionUser!.role,
      MANAGE_KNOWLEDGE_ROLES,
      "Only Owners and Administrators can manage the knowledge base.",
    );
    await removeKnowledgeSource(request.workspaceId!, request.params.id);
    reply.code(204).send();
  });

  app.post("/knowledge/search", async (request, reply) => {
    const body = searchSchema.parse(request.body);
    const results = await searchKnowledge(request.workspaceId!, body.query, body.limit);
    reply.send({ results });
  });
}
