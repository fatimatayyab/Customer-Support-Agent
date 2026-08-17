import {
  getWorkspacePlatformMetaForPlatform,
  getWorkspaceUsageForPlatform,
  insertPlatformAuditLog,
  insertWorkspaceSignupInviteForPlatform,
  listApiKeysForPlatform,
  listPlatformAuditLogForWorkspace,
  listUsersForPlatform,
  listWorkspaceSignupInvitesForPlatform,
  listWorkspacesForPlatform,
  getWorkspaceForPlatform,
  revokeApiKeyForPlatform,
  revokeWorkspaceSignupInviteForPlatform,
  updateWorkspaceStatusForPlatform,
  upsertWorkspacePlatformMetaForPlatform,
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
  const [users, auditLog, usage, apiKeys, meta] = await Promise.all([
    listUsersForPlatform(id),
    listPlatformAuditLogForWorkspace(id),
    getWorkspaceUsageForPlatform(id),
    listApiKeysForPlatform(id),
    getWorkspacePlatformMetaForPlatform(id),
  ]);
  return { workspace, users, auditLog, usage, apiKeys, meta };
}

export async function updateWorkspaceMeta(
  platformAdminId: string,
  workspaceId: string,
  params: { plan: string | null; billingNotes: string | null },
) {
  const meta = await upsertWorkspacePlatformMetaForPlatform(workspaceId, params);
  // Always logged, unlike suspend/reactivate which only ever have two
  // possible values - a plan/notes edit is free text a future billing
  // question will want the full before/after-adjacent context for.
  await insertPlatformAuditLog({
    platformAdminId,
    action: "workspace.meta_updated",
    targetWorkspaceId: workspaceId,
    detail: params,
  });
  return meta;
}

export async function revokeWorkspaceApiKey(platformAdminId: string, workspaceId: string, keyId: string) {
  const revoked = await revokeApiKeyForPlatform(workspaceId, keyId);
  if (!revoked) {
    throw new NotFoundError("API key not found or already revoked.");
  }
  // Distinguishable from a workspace owner revoking their own key
  // (workspace.routes.ts's DELETE /workspaces/api-keys/:id) - same table,
  // different actor, different audit trail, so an investigation into
  // "who revoked this key" doesn't have to guess which log to check.
  await insertPlatformAuditLog({
    platformAdminId,
    action: "workspace.api_key_revoked",
    targetWorkspaceId: workspaceId,
    detail: { keyId },
  });
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
