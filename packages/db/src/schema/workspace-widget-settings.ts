import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.js";

// The Appearance layer of the Chat Widget direction (docs/00 §9/§10,
// docs/02's "Understand"/"Channel agnostic" refinements) - identity and
// presentation, never AI behavior/configuration, which is a separate,
// unbuilt concern. `avatar_url` is a plain URL string, deliberately not
// a file upload: no blob storage exists anywhere in this stack, and
// building it is a real infra addition intentionally deferred, per the
// agreed sequencing (docs/00's Future Vision note on deferred scope).
export const widgetPositionEnum = pgEnum("widget_position", ["left", "right"]);

// Unlike workspace_platform_meta (platform-owner-only, a second bypass
// role), this table is edited by the workspace itself - a normal
// app_user + withWorkspaceContext table like any other tenant resource,
// full four-part isolation per CLAUDE.md §8: workspace_id NOT NULL
// (here also the PK, so already indexed - no separate index needed),
// RLS policy, exclusively accessed via ScopedDb.
export const workspaceWidgetSettings = pgTable(
  "workspace_widget_settings",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Null = fall back to the workspace's own business name, which is
    // what the widget already shows today - this column only exists to
    // let an owner give their assistant a distinct name if they want one.
    assistantName: text("assistant_name"),
    // Null = no proactive greeting shown (today's behavior - the panel
    // opens empty until the customer sends something first).
    greetingMessage: text("greeting_message"),
    // Hex string ("#0f172a"), validated at the API boundary (Zod), not
    // here - null = use the widget's built-in default color.
    primaryColor: text("primary_color"),
    // NOT NULL with a default, unlike the other columns: "left" or
    // "right" are the only two valid states, so there's no meaningful
    // null case the widget would need to branch on the way it does for
    // "no greeting set" or "no custom color set".
    position: widgetPositionEnum("position").notNull().default("right"),
    // A plain external URL, not a stored asset - null = no avatar shown.
    avatarUrl: text("avatar_url"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("workspace_widget_settings_tenant_isolation", {
      for: "all",
      using: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`${table.workspaceId} = current_setting('app.workspace_id', true)::uuid`,
    }),
  ],
).enableRLS();
