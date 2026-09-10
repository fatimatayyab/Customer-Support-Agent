import { and, eq, inArray, sql } from "drizzle-orm";
import { messageAttachments, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

// The metadata a message's wire payload and every history read carry for
// an attachment - deliberately no `storageKey` (internal location, not
// customer-facing) and never `data` (bytes are fetched by the download
// route only). This is the shape future AI-processing milestones would
// consume to know what kinds of attachments a message has.
export interface AttachmentMetadata {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export function toAttachmentMetadata(
  row: Pick<typeof messageAttachments.$inferSelect, "id" | "filename" | "mimeType" | "size">,
): AttachmentMetadata {
  return { id: row.id, filename: row.filename, mimeType: row.mimeType, size: row.size };
}

interface NewAttachment {
  id: string;
  workspaceId: string;
  conversationId: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  data: Buffer;
}

export async function insertAttachment(scopedDb: ScopedDb, params: NewAttachment) {
  const [attachment] = await scopedDb
    .insert(messageAttachments)
    .values({
      id: params.id,
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
      filename: params.filename,
      mimeType: params.mimeType,
      size: params.size,
      storageKey: params.storageKey,
      data: params.data,
    })
    .returning();
  return assertDefined(attachment, "insertAttachment: INSERT ... RETURNING produced no row.");
}

// The claim step of message:send. A single conditional UPDATE is what
// makes the "pending upload" model race-free: only rows that are still
// unclaimed (message_id IS NULL) AND belong to this workspace +
// conversation move to this message, and the caller compares the count
// returned against what it asked for. Any already-claimed, wrong-workspace,
// or wrong-conversation id simply isn't matched - and because the caller
// runs inside the same withWorkspaceContext transaction that inserts the
// message, a shortfall aborts the whole send, leaving the message and
// every claim rolled back together.
export async function claimAttachmentsForMessage(
  scopedDb: ScopedDb,
  workspaceId: string,
  conversationId: string,
  messageId: string,
  attachmentIds: string[],
): Promise<AttachmentMetadata[]> {
  if (attachmentIds.length === 0) {
    return [];
  }
  const rows = await scopedDb
    .update(messageAttachments)
    .set({ messageId })
    .where(
      and(
        inArray(messageAttachments.id, attachmentIds),
        eq(messageAttachments.workspaceId, workspaceId),
        eq(messageAttachments.conversationId, conversationId),
        sql`${messageAttachments.messageId} IS NULL`,
      ),
    )
    .returning({ id: messageAttachments.id, filename: messageAttachments.filename, mimeType: messageAttachments.mimeType, size: messageAttachments.size });
  return rows.map(toAttachmentMetadata);
}

// Metadata-only read (no `data` selected) for the conversation's whole
// attachment set - used to merge attachments onto a history load in one
// extra query instead of one query per message.
export async function listAttachmentsByConversation(
  scopedDb: ScopedDb,
  workspaceId: string,
  conversationId: string,
): Promise<Record<string, AttachmentMetadata[]>> {
  const rows = await scopedDb
    .select({
      id: messageAttachments.id,
      messageId: messageAttachments.messageId,
      filename: messageAttachments.filename,
      mimeType: messageAttachments.mimeType,
      size: messageAttachments.size,
    })
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.workspaceId, workspaceId),
        eq(messageAttachments.conversationId, conversationId),
        sql`${messageAttachments.messageId} IS NOT NULL`,
      ),
    );

  const byMessage: Record<string, AttachmentMetadata[]> = {};
  for (const row of rows) {
    if (!row.messageId) {
      continue;
    }
    (byMessage[row.messageId] ??= []).push(toAttachmentMetadata(row));
  }
  return byMessage;
}

// The one read path that selects the bytes - used only by the download
// routes. RLS + the workspace_id equality make a cross-workspace id
// return nothing rather than someone else's file.
export async function getAttachmentById(
  scopedDb: ScopedDb,
  workspaceId: string,
  attachmentId: string,
): Promise<Pick<
  typeof messageAttachments.$inferSelect,
  "id" | "conversationId" | "messageId" | "filename" | "mimeType" | "size" | "data"
> | null> {
  const [row] = await scopedDb
    .select({
      id: messageAttachments.id,
      conversationId: messageAttachments.conversationId,
      messageId: messageAttachments.messageId,
      filename: messageAttachments.filename,
      mimeType: messageAttachments.mimeType,
      size: messageAttachments.size,
      data: messageAttachments.data,
    })
    .from(messageAttachments)
    .where(and(eq(messageAttachments.id, attachmentId), eq(messageAttachments.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function getAttachmentMetadataById(
  scopedDb: ScopedDb,
  workspaceId: string,
  attachmentId: string,
): Promise<AttachmentMetadata | null> {
  const [row] = await scopedDb
    .select({
      id: messageAttachments.id,
      filename: messageAttachments.filename,
      mimeType: messageAttachments.mimeType,
      size: messageAttachments.size,
    })
    .from(messageAttachments)
    .where(and(eq(messageAttachments.id, attachmentId), eq(messageAttachments.workspaceId, workspaceId)))
    .limit(1);
  return row ? toAttachmentMetadata(row) : null;
}