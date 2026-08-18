import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { identifyWorkspace } from "./api.js";
import { ConfigPrompt } from "./ConfigPrompt.js";
import { clearDevApiKey, readConfig, storeDevApiKey, type WidgetConfig } from "./config.js";
import { Widget } from "./Widget.js";
import styles from "./widget.css?inline";

const STALE_KEY_MESSAGE =
  "Your saved API key no longer works - it may have been rotated or revoked, or the workspace suspended. Enter a new one.";

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
  const [staleKeyMessage, setStaleKeyMessage] = useState<string | null>(null);

  // Dev-only self-healing: a localStorage key from an earlier session can
  // go stale (workspace suspended on the Platform Owner Dashboard, key
  // rotated/revoked on /widget) with no UI path to fix it otherwise -
  // readConfig() only ever returns null when nothing is stored at all, so
  // Widget would otherwise sit on a permanent, dead "Could not identify
  // workspace" error every reload. A real embed never hits this:
  // window.CSAWidgetConfig is supplied fresh by the host page every load,
  // never persisted across a credential change - this is purely a dev
  // harness convenience, gated the same way storeDevApiKey/ConfigPrompt
  // already are. The redundant second identify call Widget itself makes
  // right after is harmless - a cheap GET, not a paid resource.
  useEffect(() => {
    if (!config || !import.meta.env.DEV) {
      return;
    }
    let cancelled = false;
    identifyWorkspace(config).catch(() => {
      if (cancelled) {
        return;
      }
      clearDevApiKey();
      setStaleKeyMessage(STALE_KEY_MESSAGE);
      setConfig(null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  if (!config) {
    if (import.meta.env.DEV) {
      return (
        <ConfigPrompt
          message={staleKeyMessage}
          onSubmit={(apiKey) => {
            setStaleKeyMessage(null);
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
