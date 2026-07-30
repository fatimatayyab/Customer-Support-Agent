export const WORKSPACE_ROLES = ["owner", "administrator", "support_agent"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
