import type { WidgetConfig } from "./config.js";

export interface IdentifiedWorkspace {
  id: string;
  name: string;
  // Appearance layer (Chat Widget direction, docs/00 §9/§10) - all
  // nullable except position, mirroring exactly what
  // workspace-identification/identify.routes.ts falls back to when a
  // workspace has never saved settings. Widget.tsx/ChatPanel.tsx read
  // these; nothing here is AI behavior/configuration, a separate concern.
  assistantName: string | null;
  greetingMessage: string | null;
  primaryColor: string | null;
  position: "left" | "right";
  avatarUrl: string | null;
}

// Mirrors the Support Orchestrator's request lifecycle Workspace
// Identification step (see 03_System_Architecture.md) from the widget
// side: the raw API key is all this call carries, and the platform
// resolves it to a workspace before anything else can happen. Phase 1
// replaces this with real Conversation handling; Phase 0 only needs to
// prove this round trip works from a genuinely embedded script.
export async function identifyWorkspace(config: WidgetConfig): Promise<IdentifiedWorkspace> {
  const response = await fetch(`${config.apiUrl}/widget/identify`, {
    headers: { "X-API-Key": config.apiKey },
  });

  if (!response.ok) {
    throw new Error("Could not identify workspace - check the widget API key.");
  }

  const body = (await response.json()) as { workspace: IdentifiedWorkspace | null };
  if (!body.workspace) {
    throw new Error("Workspace not found.");
  }

  return body.workspace;
}
