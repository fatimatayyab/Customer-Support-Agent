import {
  insertPlatformAuditLog,
  insertWorkspaceSignupInviteForPlatform,
  listPlatformAuditLogForWorkspace,
  listUsersForPlatform,
  listWorkspaceSignupInvitesForPlatform,
  listWorkspacesForPlatform,
  getWorkspaceForPlatform,
  revokeWorkspaceSignupInviteForPlatform,
  updateWorkspaceStatusForPlatform,
} from "@csa/db";
import { env } from "../../config/env.js";
import { NotFoundError } from "../../errors.js";
import { generateSignupInviteToken } from "../auth/signup-invite-token.js";

const DEFAULT_INVITE_EXPIRY_DAYS = 14;

export async function listWorkspaces() {
  return listWorkspacesForPlatform();
}

export async function getWorkspaceDetail(id: string) {
  const workspace = await getWorkspaceForPlatform(id);
  if (!workspace) {
    throw new NotFoundError("Workspace not found.");
  }
  const [users, auditLog] = await Promise.all([
    listUsersForPlatform(id),
    listPlatformAuditLogForWorkspace(id),
  ]);
  return { workspace, users, auditLog };
}

export async function suspendWorkspace(platformAdminId: string, workspaceId: string) {
  const updated = await updateWorkspaceStatusForPlatform(workspaceId, "suspended");
  if (!updated) {
    throw new NotFoundError("Workspace not found.");
  }
  // Fire-and-forget would risk losing the audit trail exactly when it
  // matters most (a billing-affecting action) - awaited, like every other
  // write in this service.
  await insertPlatformAuditLog({ platformAdminId, action: "workspace.suspended", targetWorkspaceId: workspaceId });
  return updated;
}

export async function reactivateWorkspace(platformAdminId: string, workspaceId: string) {
  const updated = await updateWorkspaceStatusForPlatform(workspaceId, "active");
  if (!updated) {
    throw new NotFoundError("Workspace not found.");
  }
  await insertPlatformAuditLog({ platformAdminId, action: "workspace.reactivated", targetWorkspaceId: workspaceId });
  return updated;
}

// Replaces pnpm invite: does exactly what create-signup-invite.ts does
// (insert a single-use, expiring, email-locked token; the existing
// public signup flow - auth.service.ts's signUp - is completely
// unchanged), just from an authenticated platform-admin route instead of
// a terminal script.
export async function createWorkspaceInvite(
  platformAdminId: string,
  params: { email: string; expiresInDays?: number },
) {
  const email = params.email.trim().toLowerCase();
  const expiresInDays = params.expiresInDays ?? DEFAULT_INVITE_EXPIRY_DAYS;
  const { rawToken, tokenHash } = generateSignupInviteToken();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const invite = await insertWorkspaceSignupInviteForPlatform({ email, tokenHash, expiresAt });
  await insertPlatformAuditLog({
    platformAdminId,
    action: "workspace_invite.created",
    detail: { email, expiresAt: invite.expiresAt },
  });

  const inviteUrl = `${env.DASHBOARD_ORIGIN}/signup?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(email)}`;
  return { inviteUrl, expiresAt: invite.expiresAt };
}

export async function listWorkspaceInvites() {
  return listWorkspaceSignupInvitesForPlatform();
}

export async function revokeWorkspaceInvite(platformAdminId: string, id: string) {
  const revoked = await revokeWorkspaceSignupInviteForPlatform(id);
  if (!revoked) {
    throw new NotFoundError("Invite not found or already used.");
  }
  await insertPlatformAuditLog({ platformAdminId, action: "workspace_invite.revoked", detail: { inviteId: id } });
}
