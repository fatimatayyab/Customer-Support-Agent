import { passwordResetTokens, users, workspaces, withWorkspaceContext } from "@csa/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "./password.js";
import { logIn } from "./auth.service.js";
import { getPasswordResetPreview, requestPasswordReset, resetPassword } from "./password-reset.service.js";
import type { EmailSender } from "../users/email-sender.js";
import { createUser, createWorkspace } from "../../test-support/fixtures.js";
import { resetDatabase } from "../../test-support/reset-database.js";

class FakeEmailSender implements EmailSender {
  sent: { type: "invite" | "reset"; to: string; inviteUrl?: string; resetUrl?: string }[] = [];
  failInvitation = false;
  failReset = false;

  async sendInvitation(input: { to: string; inviteUrl: string }) {
    if (this.failInvitation) throw new Error("provider down");
    this.sent.push({ type: "invite", to: input.to, inviteUrl: input.inviteUrl });
  }

  async sendPasswordReset(input: { to: string; resetUrl: string }) {
    if (this.failReset) throw new Error("provider down");
    this.sent.push({ type: "reset", to: input.to, resetUrl: input.resetUrl });
  }
}

function tokenFromUrl(url: string): string {
  const token = new URL(url).searchParams.get("token");
  if (!token) throw new Error("no token in URL");
  return token;
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

describe("requestPasswordReset", () => {
  it("emails a reset link and stores a single-use token for a real account", async () => {
    const workspace = await createWorkspace();
    await createUser(workspace.id, { email: "reset@example.test" });
    const sender = new FakeEmailSender();

    await requestPasswordReset(workspace.slug, "reset@example.test", sender);

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.type).toBe("reset");
    expect(sender.sent[0]?.to).toBe("reset@example.test");
    expect(sender.sent[0]?.resetUrl).toContain("/reset-password?token=");
  });

  it("is a silent no-op for an unknown email or workspace (no enumeration)", async () => {
    const workspace = await createWorkspace();
    const sender = new FakeEmailSender();

    await requestPasswordReset(workspace.slug, "ghost@example.test", sender);
    await requestPasswordReset("nonexistent-workspace", "reset@example.test", sender);

    expect(sender.sent).toHaveLength(0);
  });

  it("does not email a disabled user or a suspended workspace", async () => {
    const workspace = await createWorkspace();
    await createUser(workspace.id, { email: "disabled@example.test" });
    const sender = new FakeEmailSender();

    await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.update(users).set({ status: "disabled" }).where(eq(users.email, "disabled@example.test")),
    );
    await requestPasswordReset(workspace.slug, "disabled@example.test", sender);

    await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.update(workspaces).set({ status: "suspended" }).where(eq(workspaces.id, workspace.id)),
    );
    await requestPasswordReset(workspace.slug, "reset@example.test", sender);

    expect(sender.sent).toHaveLength(0);
  });

  it("does not fail the request when email delivery fails (no observable difference)", async () => {
    const workspace = await createWorkspace();
    await createUser(workspace.id, { email: "reset@example.test" });
    const sender = new FakeEmailSender();
    sender.failReset = true;

    await expect(requestPasswordReset(workspace.slug, "reset@example.test", sender)).resolves.toBeUndefined();
  });
});

describe("getPasswordResetPreview", () => {
  it("returns the account email for a valid, unused token", async () => {
    const workspace = await createWorkspace();
    await createUser(workspace.id, { email: "reset@example.test" });
    const sender = new FakeEmailSender();
    await requestPasswordReset(workspace.slug, "reset@example.test", sender);

    const preview = await getPasswordResetPreview(tokenFromUrl(sender.sent[0]!.resetUrl!));

    expect(preview.email).toBe("reset@example.test");
  });

  it("rejects an invalid token", async () => {
    await expect(getPasswordResetPreview("not-a-real-token")).rejects.toThrow();
  });

  it("rejects a used token", async () => {
    const workspace = await createWorkspace();
    await createUser(workspace.id, { email: "reset@example.test" });
    const sender = new FakeEmailSender();
    await requestPasswordReset(workspace.slug, "reset@example.test", sender);
    const token = tokenFromUrl(sender.sent[0]!.resetUrl!);

    await resetPassword(token, "Newpass456!");
    await expect(getPasswordResetPreview(token)).rejects.toThrow("already been used");
  });

  it("rejects an expired token", async () => {
    const workspace = await createWorkspace();
    await createUser(workspace.id, { email: "reset@example.test" });
    const sender = new FakeEmailSender();
    await requestPasswordReset(workspace.slug, "reset@example.test", sender);
    const token = tokenFromUrl(sender.sent[0]!.resetUrl!);

    await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.update(passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(getPasswordResetPreview(token)).rejects.toThrow("expired");
  });
});

describe("resetPassword", () => {
  it("resets the password, consumes the token, and makes the new password work", async () => {
    const workspace = await createWorkspace();
    const user = await createUser(workspace.id, { email: "reset@example.test" });
    const oldHash = await hashPassword("Oldpass123!");
    await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.update(users).set({ passwordHash: oldHash }).where(eq(users.id, user.id)),
    );
    const sender = new FakeEmailSender();
    await requestPasswordReset(workspace.slug, "reset@example.test", sender);
    const token = tokenFromUrl(sender.sent[0]!.resetUrl!);

    await resetPassword(token, "Newpass456!");

    // Token is consumed.
    await expect(resetPassword(token, "Anotherpass789!")).rejects.toThrow("no longer valid");

    // Old password no longer works, new one does.
    await expect(logIn({ workspaceSlug: workspace.slug, email: "reset@example.test", password: "Oldpass123!" })).rejects.toThrow();
    const result = await logIn({ workspaceSlug: workspace.slug, email: "reset@example.test", password: "Newpass456!" });
    expect(result.session.email).toBe("reset@example.test");
  });

  it("rejects an invalid token", async () => {
    await expect(resetPassword("not-a-real-token", "Newpass456!")).rejects.toThrow("invalid");
  });
});