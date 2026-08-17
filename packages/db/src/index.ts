export { db, pool } from "./client.js";
export { withWorkspaceContext, type ScopedDb } from "./tenant-context.js";
export {
  findApiKeyByHash,
  findWorkspaceBySlug,
  findWorkspaceNameById,
  findInvitationByTokenHash,
  findWorkspaceSignupInviteByTokenHash,
  claimWorkspaceSignupInvite,
} from "./auth-resolver-client.js";
export {
  findPlatformAdminByEmail,
  listWorkspacesForPlatform,
  getWorkspaceForPlatform,
  listUsersForPlatform,
  updateWorkspaceStatusForPlatform,
  insertWorkspaceSignupInviteForPlatform,
  listWorkspaceSignupInvitesForPlatform,
  revokeWorkspaceSignupInviteForPlatform,
  insertPlatformAuditLog,
  listPlatformAuditLogForWorkspace,
} from "./platform-operator-client.js";
export * from "./schema/index.js";
