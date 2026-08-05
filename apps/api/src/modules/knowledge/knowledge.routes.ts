import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WorkspaceRole } from "@csa/shared";
import { requireRole } from "../auth/require-role.js";
import { requireSession } from "../auth/require-session.js";
import { AppError } from "../../errors.js";
import {
  createKnowledgeSource,
  createKnowledgeSourceFromUpload,
  createKnowledgeSourcesFromUrls,
  listSources,
  removeKnowledgeSource,
  searchKnowledge,
} from "./knowledge.service.js";

const createSourceSchema = z.object({
  type: z.enum(["plain_text", "faq"]),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(200_000),
});

// Manually entered URLs, one per line in the dashboard's textarea,
// already split into an array client-side. Capped at 20 - matches the
// same defensive cap in knowledge.service.ts.
const createWebsiteSourcesSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(20),
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

const MAX_UPLOAD_FILE_SIZE_BYTES = 15 * 1024 * 1024;

// Dashboard-facing: session-cookie authenticated, same as workspace.routes.ts.
export async function knowledgeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);

  // Scoped to this plugin only - no other route needs multipart parsing.
  app.register(multipart, { limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES } });

  app.post("/knowledge/sources/upload", async (request, reply) => {
    requireRole(
      request.sessionUser!.role,
      MANAGE_KNOWLEDGE_ROLES,
      "Only Owners and Administrators can manage the knowledge base.",
    );

    // Iterates every part rather than using the request.file() shortcut,
    // which only reliably sees fields that arrive before the file part
    // in the multipart stream - this way the title field works
    // regardless of which order the client appended it in.
    let title: string | undefined;
    let filename: string | undefined;
    let buffer: Buffer | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file") {
        filename = part.filename;
        buffer = await part.toBuffer();
      } else if (part.fieldname === "title" && typeof part.value === "string") {
        title = part.value;
      }
    }

    if (!title || !filename || !buffer) {
      throw new AppError("A title and a file are both required.", 400);
    }

    const source = await createKnowledgeSourceFromUpload({
      workspaceId: request.workspaceId!,
      title,
      filename,
      buffer,
    });
    reply.code(201).send({ source });
  });

  app.post("/knowledge/sources/website", async (request, reply) => {
    requireRole(
      request.sessionUser!.role,
      MANAGE_KNOWLEDGE_ROLES,
      "Only Owners and Administrators can manage the knowledge base.",
    );
    const body = createWebsiteSourcesSchema.parse(request.body);
    const { sources, skipped } = await createKnowledgeSourcesFromUrls({
      workspaceId: request.workspaceId!,
      urls: body.urls,
    });
    reply.code(201).send({ sources, skipped });
  });

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
