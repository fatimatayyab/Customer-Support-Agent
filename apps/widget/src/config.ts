export interface WidgetConfig {
  apiKey: string;
  apiUrl: string;
}

declare global {
  interface Window {
    CSAWidgetConfig?: Partial<WidgetConfig>;
  }
}

const DEFAULT_API_URL = "http://localhost:4000";

// Dev-only convenience, not part of the real embed contract: lets a
// developer paste a workspace API key into a small on-page prompt
// (main.tsx's ConfigPrompt) instead of editing index.html/.env and
// restarting the dev server every time they want to test against a
// different workspace. A real host page always sets
// window.CSAWidgetConfig itself and never touches this.
const LOCAL_STORAGE_KEY = "csa-widget-dev-api-key";

// A host page sets window.CSAWidgetConfig before loading this script -
// e.g. <script>window.CSAWidgetConfig={apiKey:"..."}</script> followed by
// <script src=".../widget.js" async></script>. This is preferred over
// reading data-* attributes off document.currentScript: currentScript is
// null for ES module scripts (breaks local dev under Vite) and this way
// dev and production embeds read config identically.
//
// Returns null (never throws) when no key is available from either
// source, so the caller can render a setup prompt instead of crashing -
// see main.tsx.
//
// The localStorage fallback is gated behind import.meta.env.DEV - Vite
// replaces this with a literal `false` in a production build (`vite
// build`, i.e. the real dist/widget.js a customer embeds), so a
// misconfigured real embed (window.CSAWidgetConfig.apiKey missing) can
// never fall back to a stray dev key and can never reach the localStorage
// branch at all in production, dead code eliminated with it.
export function readConfig(): WidgetConfig | null {
  const windowConfig = window.CSAWidgetConfig;
  const apiKey = windowConfig?.apiKey || (import.meta.env.DEV ? readStoredApiKey() : null);
  if (!apiKey) {
    return null;
  }
  return { apiUrl: DEFAULT_API_URL, ...windowConfig, apiKey };
}

function readStoredApiKey(): string | null {
  try {
    return window.localStorage.getItem(LOCAL_STORAGE_KEY);
  } catch {
    // Storage can throw in a locked-down embedding context (e.g. a
    // sandboxed iframe) - a real embed always supplies apiKey via
    // CSAWidgetConfig anyway, so this fallback simply isn't available there.
    return null;
  }
}

export function storeDevApiKey(apiKey: string): void {
  window.localStorage.setItem(LOCAL_STORAGE_KEY, apiKey);
}

// Used when a stored key stops working (workspace suspended, key
// revoked/rotated since it was saved) - see main.tsx's Root(). Without
// this, a stale key persists forever with no UI path to replace it,
// since readConfig() only ever falls back to the prompt when nothing is
// stored at all, not when what's stored no longer resolves.
export function clearDevApiKey(): void {
  try {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // See readStoredApiKey - storage can throw in a locked-down context.
  }
}
