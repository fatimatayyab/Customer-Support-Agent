import { SignJWT, jwtVerify } from "jose";
import { env } from "../../config/env.js";

const secret = new TextEncoder().encode(env.SESSION_JWT_SECRET);
const TICKET_PURPOSE = "widget-attachment-download";
// Long enough for an <img> to load the moment a message renders (and a
// reconnect within that window), short enough that a URL captured in
// browser history/proxy logs can't be replayed against a file that
// later becomes stale in the conversation.
const TICKET_DURATION = "15m";

/**
 * Browsers can't set an X-API-Key header on an <img> request, so a
 * widget-rendered image can't authenticate the way the upload REST call
 * does. Same problem - and same solution - as the WebSocket handshake
 * (widget-ws-ticket.ts): the widget exchanges its API key for a
 * short-lived, single-purpose ticket via a REST call first, then points
 * the image at a URL carrying that ticket. The ticket is bound to both
 * the attachment id and the workspace id, and the download route still
 * looks the file up through the workspace-scoped repository, so a stolen
 * ticket is only good for files in the workspace it was minted for.
 */
export async function issueAttachmentDownloadTicket(workspaceId: string, attachmentId: string): Promise<string> {
  return new SignJWT({ workspaceId, attachmentId, purpose: TICKET_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TICKET_DURATION)
    .sign(secret);
}

export async function verifyAttachmentDownloadTicket(
  ticket: string,
): Promise<{ workspaceId: string; attachmentId: string } | null> {
  try {
    const { payload } = await jwtVerify(ticket, secret);
    if (
      payload.purpose !== TICKET_PURPOSE ||
      typeof payload.workspaceId !== "string" ||
      typeof payload.attachmentId !== "string"
    ) {
      return null;
    }
    return { workspaceId: payload.workspaceId, attachmentId: payload.attachmentId };
  } catch {
    return null;
  }
}