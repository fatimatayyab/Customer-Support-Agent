import type { WorkspaceRole } from "./roles.js";

export interface SessionUser {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  email: string;
}

// A platform admin is a structurally separate identity from a workspace
// User - no workspaceId/role, since it isn't a member of any tenant. Kept
// alongside SessionUser (not nested/unioned with it) so the two can never
// be confused for one another at the type level.
export interface PlatformAdminSession {
  platformAdminId: string;
  email: string;
}
