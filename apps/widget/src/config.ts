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

// A host page sets window.CSAWidgetConfig before loading this script -
// e.g. <script>window.CSAWidgetConfig={apiKey:"..."}</script> followed by
// <script src=".../widget.js" async></script>. This is preferred over
// reading data-* attributes off document.currentScript: currentScript is
// null for ES module scripts (breaks local dev under Vite) and this way
// dev and production embeds read config identically.
export function readConfig(): WidgetConfig {
  const config = window.CSAWidgetConfig;
  if (!config?.apiKey) {
    throw new Error("window.CSAWidgetConfig.apiKey must be set before loading the widget script.");
  }
  return { apiUrl: DEFAULT_API_URL, ...config, apiKey: config.apiKey };
}
