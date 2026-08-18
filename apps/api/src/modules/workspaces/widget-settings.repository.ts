import { eq } from "drizzle-orm";
import { workspaceWidgetSettings, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

// The defaults a workspace with no saved settings row gets - matching
// exactly what the widget itself falls back to today (no assistant name
// override, no greeting, no custom color, bottom-right, no avatar).
// Defined once here, not duplicated between the dashboard-facing route
// (widget-settings.routes.ts) and the widget-facing one
// (workspace-identification/identify.routes.ts) - both need to agree on
// this shape exactly.
export const DEFAULT_WIDGET_SETTINGS = {
  assistantName: null,
  greetingMessage: null,
  primaryColor: null,
  position: "right" as const,
  avatarUrl: null,
};

export async function getWidgetSettings(scopedDb: ScopedDb, workspaceId: string) {
  const [settings] = await scopedDb
    .select()
    .from(workspaceWidgetSettings)
    .where(eq(workspaceWidgetSettings.workspaceId, workspaceId))
    .limit(1);
  // No row yet is the normal starting state - nothing creates one until
  // an owner saves something for the first time. The route layer is
  // responsible for turning `null` into the same defaults the widget
  // itself falls back to, not this function.
  return settings ?? null;
}

// Upsert, not a plain update - mirrors workspace_platform_meta's exact
// reasoning: most workspaces won't have a row until the first save.
// Every field is required (not optional) deliberately - the dashboard
// form (Phase 4) always submits its full current state, the same
// "no partial-update ambiguity" choice already made for platform meta.
export async function upsertWidgetSettings(
  scopedDb: ScopedDb,
  workspaceId: string,
  params: {
    assistantName: string | null;
    greetingMessage: string | null;
    primaryColor: string | null;
    position: "left" | "right";
    avatarUrl: string | null;
  },
) {
  const [settings] = await scopedDb
    .insert(workspaceWidgetSettings)
    .values({ workspaceId, ...params })
    .onConflictDoUpdate({
      target: workspaceWidgetSettings.workspaceId,
      set: { ...params, updatedAt: new Date() },
    })
    .returning();
  return assertDefined(settings, "upsertWidgetSettings: INSERT ... RETURNING produced no row.");
}
