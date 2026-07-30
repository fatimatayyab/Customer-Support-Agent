import { useEffect, useState } from "preact/hooks";
import { identifyWorkspace, type IdentifiedWorkspace } from "./api.js";
import type { WidgetConfig } from "./config.js";

type Status =
  | { state: "loading" }
  | { state: "ready"; workspace: IdentifiedWorkspace }
  | { state: "error"; message: string };

export function Widget({ config }: { config: WidgetConfig }) {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    identifyWorkspace(config)
      .then((workspace) => setStatus({ state: "ready", workspace }))
      .catch((error: Error) => setStatus({ state: "error", message: error.message }));
  }, [config]);

  return (
    <div class="bubble">
      {status.state === "loading" && <span>Loading...</span>}
      {status.state === "ready" && <span>Chat with {status.workspace.name}</span>}
      {status.state === "error" && <span class="error">{status.message}</span>}
    </div>
  );
}
