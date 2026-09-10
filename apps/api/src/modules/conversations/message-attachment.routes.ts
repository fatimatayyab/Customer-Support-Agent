import multipart from "@fastify/multipart";
import { withWorkspaceContext } from "@csa/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, NotFoundError } from "../../errors.js";
import { rateLimitByWorkspace } from "../../rate-limit.js";
import { redisClient } from "../../redis-client.js";
import { uploadMessageAttachment } from "../../orchestrator/support-orchestrator.js";
import { requireApiKey } from "../workspace-identification/require-api-key.js";
import { issueAttachmentDownloadTicket, verifyAttachmentDownloadTicket } from "./attachment-download-ticket.js";
import {
  INLINE_RENDERABLE_TYPES,
  MAX_ATTACHMENT_FILE_SIZE_BYTES,
  validateAndNormalizeAttachment,
} from "./message-attachment.config.js";
import { getAttachmentById, getAttachmentMetadataById } from "./message-attachment.repository.js";

const conversationIdSchema = z.string().uuid();

// Widget-facing, same shape as conversation-rating.routes.ts: an upload
// costs real storage, so it's workspace-keyed (protecting a workspace's
// own exposure, the knowledge-ingestion reasoning), not IP-keyed.
const ATTACHMENT_UPLOAD_RATE_LIMIT = rateLimitByWorkspace(redisClient, "widget-attachment-upload", 30, 60 * 60);

export async function messageAttachmentRoutes(app: FastifyInstance) {
  // Scoped to this plugin only - no other route needs multipart parsing
  // (same scoping knowledge.routes.ts already establishes).
  app.register(multipart, { limits: { fileSize: MAX_ATTACHMENT_FILE_SIZE_BYTES } });

  app.post(
    "/widget/attachments",
    { preHandler: [requireApiKey, ATTACHMENT_UPLOAD_RATE_LIMIT] },
    async (request, reply) => {
      // Iterates every part rather than the request.file() shortcut -
      // same reasoning as knowledge.routes.ts's upload route: the file
      // part's position in the stream shouldn't determine whether the
      // conversationId field is found.
      let conversationId: string | undefined;
      let filename: string | undefined;
      let declaredMimeType: string | undefined;
      let buffer: Buffer | undefined;
      for await (const part of request.parts()) {
        if (part.type === "file") {
          filename = part.filename;
          declaredMimeType = part.mimetype;
          buffer = await part.toBuffer();
        } else if (part.fieldname === "conversationId" && typeof part.value === "string") {
          conversationId = part.value;
        }
      }

      if (!conversationId || !filename || declaredMimeType === undefined || !buffer) {
        throw new AppError("A conversation id and a file are both required.", 400);
      }
      const parsedConversationId = conversationIdSchema.parse(conversationId);

      const file = validateAndNormalizeAttachment(declaredMimeType, filename, buffer);
      const attachment = await uploadMessageAttachment(request.workspaceId!, parsedConversationId, file);
      reply.code(201).send({ attachment });
    },
  );

  // Exchanges the widget's API key for a short-lived, single-purpose
  // download ticket - the <img>-can't-send-headers workaround, the same
  // shape as POST /widget/session for the WebSocket. The attachment is
  // verified to exist in the requesting workspace before a ticket is
  // minted, so a random id costs nothing.
  app.post<{ Params: { id: string } }>(
    "/widget/attachments/:id/download-ticket",
    { preHandler: requireApiKey },
    async (request, reply) => {
      const attachment = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
        getAttachmentMetadataById(scopedDb, request.workspaceId!, request.params.id),
      );
      if (!attachment) {
        throw new NotFoundError("Attachment not found.");
      }
      const ticket = await issueAttachmentDownloadTicket(request.workspaceId!, attachment.id);
      reply.send({ ticket });
    },
  );

  // Serves the bytes. Authenticated by the ticket in the query string
  // (see issueAttachmentDownloadTicket) - the only path the widget's
  // <img> tags can use. The file lookup is still workspace-scoped, so a
  // ticket minted for workspace A can never read workspace B's file.
  app.get<{ Params: { id: string } }>("/widget/attachments/:id/download", async (request, reply) => {
    const ticket = (request.query as { ticket?: string }).ticket;
    const claims = ticket ? await verifyAttachmentDownloadTicket(ticket) : null;
    if (!claims || claims.attachmentId !== request.params.id) {
      throw new NotFoundError("Attachment not found.");
    }

    const attachment = await withWorkspaceContext(claims.workspaceId, (scopedDb) =>
      getAttachmentById(scopedDb, claims.workspaceId, request.params.id),
    );
    if (!attachment) {
      throw new NotFoundError("Attachment not found.");
    }

    const inline = INLINE_RENDERABLE_TYPES.has(attachment.mimeType);
    reply
      .header("Content-Type", attachment.mimeType)
      .header("X-Content-Type-Options", "nosniff")
      .header(
        "Content-Disposition",
        inline
          ? "inline"
          : `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      )
      .header("Cache-Control", "private, max-age=600");
    return reply.send(attachment.data);
  });
}