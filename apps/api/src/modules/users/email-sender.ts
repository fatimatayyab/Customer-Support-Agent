/**
 * The seam requested explicitly for this milestone: v1 ships with no
 * real email vendor (copy-link only - the owner shares the invite URL
 * however they already communicate with their team), but adding Resend
 * or another provider later should mean writing one new class and
 * changing one line in createEmailSender() below - nothing in
 * invitation.service.ts, the routes, or the schema should need to
 * change. Mirrors the AiProvider/IntegrationProvider pattern already
 * established elsewhere in this codebase.
 */

export interface SendInvitationEmailInput {
  to: string;
  workspaceName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
}

export interface EmailSender {
  sendInvitation(input: SendInvitationEmailInput): Promise<void>;
}

// Explicit "no vendor configured" implementation, not a silent stub -
// same honesty as UnsupportedSourceTypeError rejecting explicitly rather
// than pretending to support something it doesn't. The invite URL is
// always returned directly by invitation.service.ts regardless of this
// class, so no email ever needing to send doesn't block the feature.
export class NullEmailSender implements EmailSender {
  async sendInvitation(): Promise<void> {
    // Intentionally does nothing. The dashboard shows the invite link
    // directly; nothing depends on this ever actually sending mail.
  }
}

export function createEmailSender(): EmailSender {
  return new NullEmailSender();
}
