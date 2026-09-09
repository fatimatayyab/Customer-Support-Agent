import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmailSender } from "./email-sender.js";
import { createOrResendInvitation } from "./invitation.service.js";
import { createUser, createWorkspace } from "../../test-support/fixtures.js";
import { resetDatabase } from "../../test-support/reset-database.js";

class FakeEmailSender implements EmailSender {
  sent: { type: "invite" | "reset"; to: string; inviteUrl?: string; resetUrl?: string }[] = [];
  failInvitation = false;

  async sendInvitation(input: { to: string; inviteUrl: string }) {
    if (this.failInvitation) throw new Error("provider down");
    this.sent.push({ type: "invite", to: input.to, inviteUrl: input.inviteUrl });
  }

  async sendPasswordReset(input: { to: string; resetUrl: string }) {
    this.sent.push({ type: "reset", to: input.to, resetUrl: input.resetUrl });
  }
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

describe("createOrResendInvitation email delivery", () => {
  it("sends the invitation email with the correct invite link when a real sender is wired", async () => {
    const workspace = await createWorkspace();
    const inviter = await createUser(workspace.id, { role: "owner" });
    const sender = new FakeEmailSender();

    const result = await createOrResendInvitation(
      workspace.id,
      { id: inviter.id, role: inviter.role },
      "invitee@example.test",
      "support_agent",
      sender,
    );

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.type).toBe("invite");
    expect(sender.sent[0]?.to).toBe("invitee@example.test");
    expect(sender.sent[0]?.inviteUrl).toBe(result.inviteUrl);
    expect(result.inviteUrl).toContain("/accept-invite?token=");
  });

  it("still returns a working invite link when email delivery fails", async () => {
    const workspace = await createWorkspace();
    const inviter = await createUser(workspace.id, { role: "owner" });
    const sender = new FakeEmailSender();
    sender.failInvitation = true;

    const result = await createOrResendInvitation(
      workspace.id,
      { id: inviter.id, role: inviter.role },
      "invitee@example.test",
      "support_agent",
      sender,
    );

    expect(result.inviteUrl).toContain("/accept-invite?token=");
    expect(sender.sent).toHaveLength(0);
  });
});