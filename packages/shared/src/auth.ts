import type { WorkspaceRole } from "./roles.js";

export interface SessionUser {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  email: string;
}
