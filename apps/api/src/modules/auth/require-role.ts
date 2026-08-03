import type { WorkspaceRole } from "@csa/shared";
import { ForbiddenError } from "../../errors.js";

export function requireRole(role: WorkspaceRole, allowedRoles: readonly WorkspaceRole[], message: string): void {
  if (!allowedRoles.includes(role)) {
    throw new ForbiddenError(message);
  }
}
