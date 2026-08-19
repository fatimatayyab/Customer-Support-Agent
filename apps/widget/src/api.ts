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

const IDENTIFY_TIMEOUT_MS = 8000;
const IDENTIFY_MAX_ATTEMPTS = 3;
const IDENTIFY_RETRY_DELAY_MS = 1000;

async function fetchIdentify(config: WidgetConfig): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IDENTIFY_TIMEOUT_MS);
  try {
    return await fetch(`${config.apiUrl}/widget/identify`, {
      headers: { "X-API-Key": config.apiKey },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isTransientFailure(error: unknown): boolean {
  // A real HTTP response (401, 404-shaped "workspace not found") means
  // the server already answered - retrying wouldn't change that. Only a
  // failed/timed-out fetch itself (no response at all) is worth retrying:
  // fetch() rejects with a TypeError for a network-level failure, and
  // AbortController.abort() rejects with a DOMException named
  // "AbortError" - both are consistent across browsers.
  return error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError");
}

// Mirrors the Support Orchestrator's request lifecycle Workspace
// Identification step (see 03_System_Architecture.md) from the widget
// side: the raw API key is all this call carries, and the platform
// resolves it to a workspace before anything else can happen. Phase 1
// replaces this with real Conversation handling; Phase 0 only needs to
// prove this round trip works from a genuinely embedded script.
//
// Retries only a transient failure (timeout/network error) a couple of
// times before giving up - a single blip at page-load time used to
// permanently break the widget for that page view (stuck on the generic
// error bubble) with no equivalent to the WS layer's own retry story.
export async function identifyWorkspace(config: WidgetConfig): Promise<IdentifiedWorkspace> {
  for (let attempt = 1; attempt <= IDENTIFY_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchIdentify(config);

      if (!response.ok) {
        throw new Error("Could not identify workspace - check the widget API key.");
      }

      const body = (await response.json()) as { workspace: IdentifiedWorkspace | null };
      if (!body.workspace) {
        throw new Error("Workspace not found.");
      }

      return body.workspace;
    } catch (error) {
      if (!isTransientFailure(error) || attempt === IDENTIFY_MAX_ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, IDENTIFY_RETRY_DELAY_MS));
    }
  }
  // Unreachable - the loop always either returns or throws - but keeps
  // TypeScript happy about a guaranteed return value.
  throw new Error("Could not identify workspace.");
}
