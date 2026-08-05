import { findInvitationByTokenHash, findWorkspaceNameById, withWorkspaceContext } from "@csa/db";
import type { SessionUser, WorkspaceRole } from "@csa/shared";
import { hashPassword } from "../auth/password.js";
import { signSessionToken } from "../auth/session-token.js";
import { env } from "../../config/env.js";
import { AppError, ForbiddenError, NotFoundError } from "../../errors.js";
import { getWorkspaceById } from "../workspaces/workspace.repository.js";
import { createEmailSender } from "./email-sender.js";
import {
  getPendingInvitationByEmail,
  insertInvitation,
  listPendingInvitations as listPendingInvitationsRepo,
  markInvitationAccepted,
  revokeInvitation as revokeInvitationRepo,
  rotateInvitation,
} from "./invitation.repository.js";
import { generateInvitationToken, hashInvitationToken } from "./invitation-token.js";
import { getUserByEmail, getUserById, insertUser } from "./user.repository.js";

const INVITATION_EXPIRY_DAYS = 7;
const UNIQUE_VIOLATION = "23505";
const emailSender = createEmailSender();

// Same check as auth.service.ts's isUniqueSlugViolation, against a
// different constraint (invitations_workspace_id_email_pending_unique).
// Drizzle wraps the raw pg driver error in a DrizzleQueryError - the
// real `code` lives on `.cause`, not the top-level error, caught live:
// the first version of this check only looked at the top level and
// never actually matched, so a genuine race always fell through to a
// generic 500 instead of the intended friendly message.
function isUniqueViolation(error: unknown): boolean {
  return hasPgErrorCode(error, UNIQUE_VIOLATION) || hasPgErrorCode((error as { cause?: unknown })?.cause, UNIQUE_VIOLATION);
}

function hasPgErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === code;
}

export async function createOrResendInvitation(
  workspaceId: string,
  inviter: { id: string; role: WorkspaceRole },
  email: string,
  role: WorkspaceRole,
): Promise<{ inviteUrl: string; expiresAt: Date }> {
  // Prevents a lower-privileged admin from minting a new Owner. Only an
  // existing Owner can grant the Owner role - deliberate, not yet
  // encoded anywhere else in this codebase, worth being explicit about.
  if (role === "owner" && inviter.role !== "owner") {
    throw new ForbiddenError("Only Owners can invite someone as an Owner.");
  }

  // Normalized before any DB read - without this, "User@x.com" and
  // "user@x.com" are treated as different people by every check below
  // (the pending-invite dedup, the already-a-member check, and the
  // unique constraint added for the race fix below), letting the exact
  // same email end up with two live invitations or two accounts.
  email = email.trim().toLowerCase();

  const { rawToken, tokenHash } = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  let workspaceName: string;
  let inviterName: string;
  try {
    ({ workspaceName, inviterName } = await withWorkspaceContext(workspaceId, async (scopedDb) => {
      const existingUser = await getUserByEmail(scopedDb, workspaceId, email);
      if (existingUser) {
        throw new AppError("This email already has an account in this workspace.", 409);
      }

      // Re-inviting an email that already has a pending invitation rotates
      // that row's token/role/expiry instead of creating a duplicate -
      // this same code path is what "Resend" calls.
      const existing = await getPendingInvitationByEmail(scopedDb, workspaceId, email);
      if (existing) {
        await rotateInvitation(scopedDb, workspaceId, existing.id, {
          role,
          tokenHash,
          invitedByUserId: inviter.id,
          expiresAt,
        });
      } else {
        // The read above can lose a race to a concurrent request inviting
        // the same not-yet-pending email (double-click, or two admins at
        // once) - both could see "no existing pending invite" and both
        // reach here. invitations_workspace_id_email_pending_unique is
        // the real guard; the read above is just a fast-path avoiding a
        // failed insert in the common case.
        await insertInvitation(scopedDb, {
          workspaceId,
          email,
          role,
          tokenHash,
          invitedByUserId: inviter.id,
          expiresAt,
        });
      }

      const [workspace, inviterUser] = await Promise.all([
        getWorkspaceById(scopedDb, workspaceId),
        getUserById(scopedDb, workspaceId, inviter.id),
      ]);
      return {
        workspaceName: workspace?.name ?? "your workspace",
        inviterName: inviterUser?.name ?? "A team member",
      };
    }));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("Someone just invited this email - refresh and try Resend instead.", 409);
    }
    throw error;
  }

  const inviteUrl = `${env.DASHBOARD_ORIGIN}/accept-invite?token=${rawToken}`;

  // Best-effort: a real provider (once one exists) failing to send
  // shouldn't block invitation creation - the link itself is already
  // valid and returned to the caller either way. NullEmailSender never
  // throws, so this only matters once a real EmailSender is wired in.
  try {
    await emailSender.sendInvitation({ to: email, workspaceName, inviterName, role, inviteUrl });
  } catch {
    // Swallowed deliberately - see comment above.
  }

  return { inviteUrl, expiresAt };
}

export async function listWorkspaceInvitations(workspaceId: string) {
  return withWorkspaceContext(workspaceId, (scopedDb) => listPendingInvitationsRepo(scopedDb, workspaceId));
}

export async function revokeWorkspaceInvitation(workspaceId: string, id: string): Promise<void> {
  const revoked = await withWorkspaceContext(workspaceId, (scopedDb) => revokeInvitationRepo(scopedDb, workspaceId, id));
  if (!revoked) {
    throw new NotFoundError("Invitation not found.");
  }
}

/**
 * Resolves an invitation by its raw token via the auth_resolver client -
 * the same chicken-and-egg problem findWorkspaceBySlug/findApiKeyByHash
 * already solve: there is no tenant context yet to scope a normal query
 * with, because resolving the token IS how the workspace gets known.
 */
export async function getInvitationPreview(rawToken: string) {
  const invitation = await findInvitationByTokenHash(hashInvitationToken(rawToken));
  if (!invitation) {
    throw new NotFoundError("This invitation link is invalid.");
  }
  if (invitation.status === "accepted") {
    throw new NotFoundError("This invitation has already been accepted.");
  }
  if (invitation.status === "revoked") {
    throw new NotFoundError("This invitation has been revoked.");
  }
  if (invitation.expiresAt < new Date()) {
    throw new NotFoundError("This invitation has expired.");
  }

  const workspaceName = await findWorkspaceNameById(invitation.workspaceId);
  return { workspaceName: workspaceName ?? "this workspace", email: invitation.email, role: invitation.role };
}

export async function acceptInvitation(
  rawToken: string,
  params: { name: string; password: string },
): Promise<{ token: string; session: SessionUser }> {
  const invitation = await findInvitationByTokenHash(hashInvitationToken(rawToken));
  if (!invitation || invitation.status !== "pending" || invitation.expiresAt < new Date()) {
    throw new NotFoundError("This invitation is no longer valid.");
  }

  // Hashing before the transaction - Argon2 is deliberately slow, no
  // reason to hold a DB transaction open for it.
  const passwordHash = await hashPassword(params.password);

  return withWorkspaceContext(invitation.workspaceId, async (scopedDb) => {
    // Mirrors logIn's identical guard - without this, a stale invitation
    // could still be accepted into a workspace that's since been
    // suspended, handing out a working session (up to 7 days, since
    // sessions can't be force-revoked) into a workspace that's supposed
    // to be locked out.
    const workspace = await getWorkspaceById(scopedDb, invitation.workspaceId);
    if (!workspace || workspace.status !== "active") {
      throw new NotFoundError("This invitation is no longer valid.");
    }

    // The real, concurrency-safe guard - a conditional UPDATE, not a
    // separate read-then-write. If another request already accepted (or
    // revoked) this token in the moment between the check above and
    // here, this returns null and no duplicate user gets created.
    const accepted = await markInvitationAccepted(scopedDb, invitation.workspaceId, invitation.id);
    if (!accepted) {
      throw new NotFoundError("This invitation is no longer valid.");
    }

    // Email always comes from the invitation record, never the request
    // body - accepting a token issued for one address must never be able
    // to register a different one.
    const user = await insertUser(scopedDb, {
      workspaceId: invitation.workspaceId,
      email: invitation.email,
      passwordHash,
      name: params.name,
      role: invitation.role,
    });

    const session: SessionUser = {
      userId: user.id,
      workspaceId: invitation.workspaceId,
      role: user.role,
      email: user.email,
    };
    const token = await signSessionToken(session);
    return { token, session };
  });
}
