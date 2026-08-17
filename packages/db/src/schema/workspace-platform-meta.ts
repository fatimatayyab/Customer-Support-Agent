import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

// Platform-owner-only commercial/operational metadata about a workspace -
// deliberately a SEPARATE table, not columns on `workspaces` itself.
// workspace.repository.ts's getWorkspaceById does a bare select() and
// that result flows straight into /auth/me's response to the workspace's
// OWN session; adding billing_notes as a workspaces column would leak
// the platform owner's internal notes about a client to that client the
// next time someone touches that route. A separate, platform_operator-
// only table (RLS enabled, zero policies - same hard-deny pattern as
// platform_admins) makes that leak structurally impossible instead of
// relying on remembering to exclude a column.
//
// `plan` is free text, deliberately not an enum: there is no approved
// pricing/billing model yet (no Stripe, no subscriptions table anywhere
// in this schema), so committing to fixed tier names now would be
// exactly the premature-structure mistake this codebase's own
// conventions warn against. Promote to an enum once real plans are
// approved - renaming a handful of text values then is easy; guessing
// wrong now and migrating away from a bad enum is not.
export const workspacePlatformMeta = pgTable("workspace_platform_meta", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  plan: text("plan"),
  billingNotes: text("billing_notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
