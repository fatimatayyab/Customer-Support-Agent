import { render } from "preact";
import { useState } from "preact/hooks";
import { ConfigPrompt } from "./ConfigPrompt.js";
import { readConfig, storeDevApiKey, type WidgetConfig } from "./config.js";
import { Widget } from "./Widget.js";
import styles from "./widget.css?inline";

// No key from window.CSAWidgetConfig or the dev localStorage fallback ->
// show a small setup prompt instead of crashing (readConfig() used to
// throw here). Saving a key re-reads config and swaps straight to the
// real Widget - no page reload needed.
//
// The prompt itself is also DEV-gated, not just the localStorage read it
// writes to (config.ts) - a real, misconfigured customer embed must never
// show an end visitor a box inviting them to paste an API key. In a
// production build this branch just logs to the console (for the site
// owner's own devtools, not the visitor) and renders nothing, which is
// what readConfig() throwing used to do minus the uncaught exception.
function Root() {
  const [config, setConfig] = useState<WidgetConfig | null>(() => readConfig());

  if (!config) {
    if (import.meta.env.DEV) {
      return (
        <ConfigPrompt
          onSubmit={(apiKey) => {
            storeDevApiKey(apiKey);
            setConfig(readConfig());
          }}
        />
      );
    }
    console.error("CSA Widget: window.CSAWidgetConfig.apiKey must be set before the widget script loads.");
    return null;
  }

  return <Widget config={config} />;
}

function mount(): void {
  const host = document.createElement("div");
  host.id = "csa-widget-root";
  document.body.appendChild(host);

  // Shadow DOM isolates the widget's styles from (and shields it from)
  // whatever the host page's own CSS/JS is doing - a hard requirement
  // for a script embedded on arbitrary third-party sites the platform
  // doesn't control.
  const shadowRoot = host.attachShadow({ mode: "open" });

  const styleTag = document.createElement("style");
  styleTag.textContent = styles;
  shadowRoot.appendChild(styleTag);

  const mountPoint = document.createElement("div");
  shadowRoot.appendChild(mountPoint);

  render(<Root />, mountPoint);
}

mount();
