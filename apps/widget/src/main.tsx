import { render } from "preact";
import { readConfig } from "./config.js";
import { Widget } from "./Widget.js";
import styles from "./widget.css?inline";

function mount(): void {
  const config = readConfig();

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

  render(<Widget config={config} />, mountPoint);
}

mount();
