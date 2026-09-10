import { describe, expect, it } from "vitest";
import { issueAttachmentDownloadTicket, verifyAttachmentDownloadTicket } from "./attachment-download-ticket.js";

const WORKSPACE_ID = "11111111-1111-1111-1111-111111111111";
const ATTACHMENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("attachment download ticket", () => {
  it("round-trips: a ticket issued for a workspace + attachment verifies back to both", async () => {
    const ticket = await issueAttachmentDownloadTicket(WORKSPACE_ID, ATTACHMENT_ID);
    const result = await verifyAttachmentDownloadTicket(ticket);
    expect(result).toEqual({ workspaceId: WORKSPACE_ID, attachmentId: ATTACHMENT_ID });
  });

  it("rejects a malformed/garbage token", async () => {
    expect(await verifyAttachmentDownloadTicket("not-a-real-jwt")).toBeNull();
    expect(await verifyAttachmentDownloadTicket("")).toBeNull();
  });

  it("rejects a ticket signed with a different purpose claim", async () => {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.SESSION_JWT_SECRET);
    const token = await new SignJWT({
      workspaceId: WORKSPACE_ID,
      attachmentId: ATTACHMENT_ID,
      purpose: "something-else",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secret);

    expect(await verifyAttachmentDownloadTicket(token)).toBeNull();
  });

  it("rejects a ticket missing the attachment claim", async () => {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.SESSION_JWT_SECRET);
    const token = await new SignJWT({ workspaceId: WORKSPACE_ID, purpose: "widget-attachment-download" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secret);

    expect(await verifyAttachmentDownloadTicket(token)).toBeNull();
  });
});