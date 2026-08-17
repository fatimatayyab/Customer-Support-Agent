import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { platformAdmins } from "./platform-admins.js";
import { workspaces } from "./workspaces.js";

// The accountability trail for the Platform Owner Dashboard: who
// provisioned/suspended/reactivated which workspace, and when. Mirrors
// integration_action_logs' shape (action as free text, not an enum -
// there's no fixed upfront list of platform actions any more than there
// was of integration actions).
export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platformAdminId: uuid("platform_admin_id")
      .notNull()
      .references(() => platformAdmins.id),
    action: text("action").notNull(),
    // Nullable + SET NULL, not cascade: an audit trail's entire purpose is
    // to survive the thing it's about - same reasoning as
    // integration_action_logs.integration_id and messages.sender_user_id.
    targetWorkspaceId: uuid("target_workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("platform_audit_log_target_workspace_id_idx").on(table.targetWorkspaceId)],
  // RLS enabled, zero policies (same as platform_admins) - only the
  // platform_operator role (BYPASSRLS) can touch this table at all.
).enableRLS();
