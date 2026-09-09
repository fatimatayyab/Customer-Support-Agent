import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Resend SDK at the module boundary - tests never hit the real
// API. vi.hoisted so the mock factory can reference the spies. ResendMock
// must be constructible (the sender does `new Resend(...)`), so it's a
// plain function, not an arrow.
const { sendMock, ResendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  ResendMock: vi.fn(function () {
    return { emails: { send: sendMock } };
  }),
}));

vi.mock("resend", () => ({
  Resend: ResendMock,
}));

import { createEmailSender, NullEmailSender } from "./email-sender.js";
import { EmailDeliveryError, ResendEmailSender } from "./resend-email-sender.js";

const INVITE_INPUT = {
  to: "invitee@example.test",
  workspaceName: "Acme",
  inviterName: "Sara",
  role: "administrator",
  inviteUrl: "https://app.example.test/accept-invite?token=abc123",
};

const RESET_INPUT = {
  to: "reset@example.test",
  resetUrl: "https://app.example.test/reset-password?token=xyz789",
};

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null });
});

describe("ResendEmailSender", () => {
  function makeSender() {
    return new ResendEmailSender({ apiKey: "re_secret-key", from: "no-reply@buildiq.test" });
  }

  it("constructs the Resend SDK with the configured API key", () => {
    makeSender();
    expect(ResendMock).toHaveBeenCalledWith("re_secret-key");
  });

  it("sends an invitation with the correct from/to/subject and link", async () => {
    await makeSender().sendInvitation(INVITE_INPUT);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [args] = sendMock.mock.calls[0] as [{ from: string; to: string; subject: string; text: string }];
    expect(args.from).toBe("no-reply@buildiq.test");
    expect(args.to).toBe("invitee@example.test");
    expect(args.subject).toContain("Acme");
    expect(args.text).toContain(INVITE_INPUT.inviteUrl);
  });

  it("sends a password-reset email with the reset link", async () => {
    await makeSender().sendPasswordReset(RESET_INPUT);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [args] = sendMock.mock.calls[0] as [{ from: string; to: string; subject: string; text: string }];
    expect(args.to).toBe("reset@example.test");
    expect(args.subject).toContain("Reset");
    expect(args.text).toContain(RESET_INPUT.resetUrl);
  });

  it("throws EmailDeliveryError when Resend reports a failure", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "rate limited" } });
    await expect(makeSender().sendInvitation(INVITE_INPUT)).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(makeSender().sendPasswordReset(RESET_INPUT)).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it("never leaks the API key in a failure", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "rate limited" } });
    const sender = makeSender();
    try {
      await sender.sendInvitation(INVITE_INPUT);
    } catch (error) {
      expect((error as Error).message).not.toContain("re_secret-key");
    }
  });
});

describe("NullEmailSender", () => {
  it("is a no-op for both email types", async () => {
    const sender = new NullEmailSender();
    await expect(sender.sendInvitation(INVITE_INPUT)).resolves.toBeUndefined();
    await expect(sender.sendPasswordReset(RESET_INPUT)).resolves.toBeUndefined();
  });
});

describe("createEmailSender (provider selection)", () => {
  it("returns the NullEmailSender by default (EMAIL_PROVIDER is not resend in tests)", () => {
    expect(createEmailSender()).toBeInstanceOf(NullEmailSender);
  });
});