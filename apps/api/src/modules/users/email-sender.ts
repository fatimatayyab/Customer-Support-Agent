import { env } from "../../config/env.js";
import { ResendEmailSender } from "./resend-email-sender.js";

/**
 * The seam requested explicitly for the invitation milestone: v1 shipped
 * with no real email vendor (copy-link only - the owner shares the invite
 * URL however they already communicate with their team), and the seam was
 * designed so adding Resend (now) or AWS SES (when BuildIQ moves to AWS)
 * means writing one implementation class and changing the provider value -
 * nothing in invitation.service.ts, the auth/reset flow, the routes, or
 * the schema needs to change. Mirrors the AiProvider/IntegrationProvider
 * pattern already established elsewhere in this codebase.
 *
 * Application/business logic depends ONLY on this interface - never on a
 * provider class. The intended architecture is:
 *
 *   Application → EmailSender → ResendEmailSender → Resend
 *   (later)     → EmailSender → SesEmailSender      → AWS SES
 */

export interface SendInvitationEmailInput {
  to: string;
  workspaceName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
}

export interface SendPasswordResetEmailInput {
  to: string;
  resetUrl: string;
}

export interface EmailSender {
  sendInvitation(input: SendInvitationEmailInput): Promise<void>;
  sendPasswordReset(input: SendPasswordResetEmailInput): Promise<void>;
}

// Explicit "no vendor configured" implementation, not a silent stub -
// same honesty as UnsupportedSourceTypeError rejecting explicitly rather
// than pretending to support something it doesn't. The invite URL is
// always returned directly by invitation.service.ts regardless of this
// class, so no email ever needing to send doesn't block the feature.
export class NullEmailSender implements EmailSender {
  async sendInvitation(_input: SendInvitationEmailInput): Promise<void> {
    // Intentionally does nothing. The dashboard shows the invite link
    // directly; nothing depends on this ever actually sending mail.
  }

  async sendPasswordReset(_input: SendPasswordResetEmailInput): Promise<void> {
    // Intentionally does nothing. Used by local/test environments where
    // real delivery isn't wired (EMAIL_PROVIDER=none).
  }
}

// EMAIL_PROVIDER=resend implies RESEND_API_KEY/EMAIL_FROM (validated in
// env.ts's superRefine), so the non-null assertions here are safe - the
// app won't even boot with that provider misconfigured.
export function createEmailSender(): EmailSender {
  if (env.EMAIL_PROVIDER === "resend") {
    return new ResendEmailSender({ apiKey: env.RESEND_API_KEY!, from: env.EMAIL_FROM! });
  }
  return new NullEmailSender();
}