import { findPasswordResetTokenByTokenHash, findWorkspaceBySlug, withWorkspaceContext } from "@csa/db";
import { env } from "../../config/env.js";
import { NotFoundError } from "../../errors.js";
import { hashPassword } from "./password.js";
import { createEmailSender, type EmailSender } from "../users/email-sender.js";
import { claimPasswordResetToken, insertPasswordResetToken } from "../users/password-reset.repository.js";
import { generatePasswordResetToken, hashPasswordResetToken } from "../users/password-reset-token.js";
import { getUserByEmail, getUserById, updateUserPassword } from "../users/user.repository.js";
import { getWorkspaceById } from "../workspaces/workspace.repository.js";

const RESET_EXPIRY_HOURS = 1;
const defaultEmailSender = createEmailSender();

/**
 * Single-use, expiring password-reset flow. The request endpoint MUST NOT
 * reveal whether an account exists - it always completes the same way
 * (and the caller always responds the same), the only observable
 * difference being whether an email is sent. Mirrors the invitation flow's
 * preview-then-claim split and its atomic single-use guarantee.
 */

export async function requestPasswordReset(
  workspaceSlug: string,
  email: string,
  emailSender: EmailSender = defaultEmailSender,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();

  // No account to reset → indistinguishable from "no such user" (no
  // enumeration), so these early returns are deliberately silent.
  const workspace = await findWorkspaceBySlug(workspaceSlug);
  if (!workspace || workspace.status !== "active") {
    return;
  }

  const user = await withWorkspaceContext(workspace.id, (scopedDb) =>
    getUserByEmail(scopedDb, workspace.id, normalizedEmail),
  );
  if (!user || user.status !== "active") {
    return;
  }

  const { rawToken, tokenHash } = generatePasswordResetToken();
  const expiresAt = new Date(Date.now() + RESET_EXPIRY_HOURS * 60 * 60 * 1000);

  await withWorkspaceContext(workspace.id, (scopedDb) =>
    insertPasswordResetToken(scopedDb, workspace.id, user.id, tokenHash, expiresAt),
  );

  const resetUrl = `${env.DASHBOARD_ORIGIN}/reset-password?token=${rawToken}`;
  try {
    await emailSender.sendPasswordReset({ to: normalizedEmail, resetUrl });
  } catch {
    // Best-effort: a provider failure must never leak account existence or
    // fail the request - the token simply goes unsent. Operational
    // visibility is handled by the route's request.log (never the token).
  }
}

export async function getPasswordResetPreview(rawToken: string): Promise<{ email: string }> {
  const token = await findPasswordResetTokenByTokenHash(hashPasswordResetToken(rawToken));
  if (!token) {
    throw new NotFoundError("This reset link is invalid.");
  }
  if (token.usedAt) {
    throw new NotFoundError("This reset link has already been used.");
  }
  if (token.expiresAt < new Date()) {
    throw new NotFoundError("This reset link has expired.");
  }

  const user = await withWorkspaceContext(token.workspaceId, (scopedDb) =>
    getUserById(scopedDb, token.workspaceId, token.userId),
  );
  if (!user) {
    throw new NotFoundError("This reset link is invalid.");
  }
  // The email is safe to expose to the preview: whoever holds the raw
  // token already received it at that address (same allowance as the
  // invitation preview).
  return { email: user.email };
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const token = await findPasswordResetTokenByTokenHash(hashPasswordResetToken(rawToken));
  if (!token) {
    throw new NotFoundError("This reset link is invalid.");
  }

  // Hashing before the transaction - Argon2 is deliberately slow, no
  // reason to hold a DB transaction open for it.
  const passwordHash = await hashPassword(newPassword);

  await withWorkspaceContext(token.workspaceId, async (scopedDb) => {
    // Mirrors logIn/acceptInvitation: a reset into a suspended workspace
    // or for a disabled user is refused even with a valid token.
    const workspace = await getWorkspaceById(scopedDb, token.workspaceId);
    const user = await getUserById(scopedDb, token.workspaceId, token.userId);
    if (!workspace || workspace.status !== "active" || !user || user.status !== "active") {
      throw new NotFoundError("This reset link is no longer valid.");
    }

    // The single-use guarantee: consumes the token in the same update
    // that verifies it's unused and unexpired (race-safe).
    const claimed = await claimPasswordResetToken(scopedDb, token.workspaceId, token.id);
    if (!claimed) {
      throw new NotFoundError("This reset link is no longer valid.");
    }

    await updateUserPassword(scopedDb, token.workspaceId, token.userId, passwordHash);
  });
}