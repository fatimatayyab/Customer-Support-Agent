import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withWorkspaceContext } from "@csa/db";
import type { WorkspaceRole } from "@csa/shared";
import { requireRole } from "../auth/require-role.js";
import { requireSession } from "../auth/require-session.js";
import { DEFAULT_WIDGET_SETTINGS, getWidgetSettings, upsertWidgetSettings } from "./widget-settings.repository.js";

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Every field required, not partial - the dashboard form (Phase 4) always
// submits its full current state, the same choice already made for
// workspace_platform_meta, avoiding any "omit vs. explicitly clear"
// ambiguity.
const widgetSettingsSchema = z.object({
  assistantName: z.string().min(1).max(100).nullable(),
  greetingMessage: z.string().min(1).max(500).nullable(),
  primaryColor: z.string().regex(HEX_COLOR_PATTERN, "Must be a hex color like #0f172a.").nullable(),
  position: z.enum(["left", "right"]),
  avatarUrl: z.string().url().max(2048).nullable(),
});

const MANAGE_WIDGET_SETTINGS_ROLES: WorkspaceRole[] = ["owner", "administrator"];

// Dashboard-facing, same auth/CORS posture as workspace.routes.ts.
// Deliberately its own route file rather than added to workspace.routes.ts -
// mirrors how conversation-rating.routes.ts stays separate from
// conversation.routes.ts for a growing, distinct sub-concern.
export async function widgetSettingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);

  app.get("/workspaces/widget-settings", async (request, reply) => {
    const settings = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      getWidgetSettings(scopedDb, request.workspaceId!),
    );
    reply.send({
      settings: settings
        ? {
            assistantName: settings.assistantName,
            greetingMessage: settings.greetingMessage,
            primaryColor: settings.primaryColor,
            position: settings.position,
            avatarUrl: settings.avatarUrl,
            updatedAt: settings.updatedAt,
          }
        : { ...DEFAULT_WIDGET_SETTINGS, updatedAt: null },
    });
  });

  app.put("/workspaces/widget-settings", async (request, reply) => {
    requireRole(
      request.sessionUser!.role,
      MANAGE_WIDGET_SETTINGS_ROLES,
      "Only Owners and Administrators can change widget appearance.",
    );
    const body = widgetSettingsSchema.parse(request.body);
    const settings = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      upsertWidgetSettings(scopedDb, request.workspaceId!, body),
    );
    reply.send({
      settings: {
        assistantName: settings.assistantName,
        greetingMessage: settings.greetingMessage,
        primaryColor: settings.primaryColor,
        position: settings.position,
        avatarUrl: settings.avatarUrl,
        updatedAt: settings.updatedAt,
      },
    });
  });
}
