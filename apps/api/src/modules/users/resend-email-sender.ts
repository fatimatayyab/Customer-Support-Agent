import { Resend } from "resend";
import type { EmailSender, SendInvitationEmailInput, SendPasswordResetEmailInput } from "./email-sender.js";

// A deliberate operational error, not an AppError: it never reaches a
// customer-facing response (both call sites - invitation.service.ts and
// the password-reset flow - catch it and degrade gracefully). Thrown when
// Resend reports a send failure, so callers can distinguish "delivery
// failed" from a programming bug without ever seeing the API key.
export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(`Email delivery failed: ${message}`);
  }
}

/**
 * The Resend implementation of EmailSender (EMAIL_PROVIDER=resend). All
 * provider knowledge lives here and only here: the SDK, the templates, the
 * from-address, and the API-key handling. Nothing about Resend leaks into
 * invitation.service.ts, the password-reset flow, routes, or the schema -
 * swap this for a SesEmailSender behind the same EmailSender when BuildIQ
 * moves to AWS, and only createEmailSender()'s provider value changes.
 *
 * Credentials come exclusively from the constructor (which createEmailSender
 * feeds from env) - never from frontend code, never logged. Failures surface
 * as EmailDeliveryError for the caller to log/handle.
 */
export class ResendEmailSender implements EmailSender {
  private readonly resend: Resend;

  constructor(private readonly config: { apiKey: string; from: string }) {
    this.resend = new Resend(config.apiKey);
  }

  async sendInvitation(input: SendInvitationEmailInput): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.config.from,
      to: input.to,
      subject: `You've been invited to ${input.workspaceName}`,
      text: this.invitationText(input),
      html: this.invitationHtml(input),
    });
    if (error) {
      throw new EmailDeliveryError(error.message);
    }
  }

  async sendPasswordReset(input: SendPasswordResetEmailInput): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.config.from,
      to: input.to,
      subject: "Reset your password",
      text: this.resetText(input),
      html: this.resetHtml(input),
    });
    if (error) {
      throw new EmailDeliveryError(error.message);
    }
  }

  private invitationText(input: SendInvitationEmailInput): string {
    return [
      `${input.inviterName} invited you to join ${input.workspaceName} on the BuildIQ AI Support Agent as ${input.role}.`,
      "",
      "Accept the invitation:",
      input.inviteUrl,
      "",
      "This link expires in 7 days. If you weren't expecting this, you can ignore it.",
    ].join("\n");
  }

  private invitationHtml(input: SendInvitationEmailInput): string {
    return `<p><strong>${escapeHtml(input.inviterName)}</strong> invited you to join <strong>${escapeHtml(input.workspaceName)}</strong> on the BuildIQ AI Support Agent as ${escapeHtml(input.role)}.</p><p><a href="${escapeHtml(input.inviteUrl)}">Accept the invitation</a></p><p style="color:#64748b">This link expires in 7 days. If you weren't expecting this, you can ignore it.</p>`;
  }

  private resetText(input: SendPasswordResetEmailInput): string {
    return [
      "We received a request to reset your password.",
      "",
      "Reset your password:",
      input.resetUrl,
      "",
      "This link is single-use and expires shortly. If you didn't request it, you can ignore this email.",
    ].join("\n");
  }

  private resetHtml(input: SendPasswordResetEmailInput): string {
    return `<p>We received a request to reset your password.</p><p><a href="${escapeHtml(input.resetUrl)}">Reset your password</a></p><p style="color:#64748b">This link is single-use and expires shortly. If you didn't request it, you can ignore this email.</p>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}