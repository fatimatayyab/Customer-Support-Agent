import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { initErrorTracking } from "./error-tracking.js";

async function main() {
  initErrorTracking();
  const app = await buildApp();

  await app.listen({ port: env.API_PORT, host: env.API_HOST });

  // Without this, a deploy/restart (SIGTERM) kills the process mid-flight -
  // dropping open WebSocket connections and any in-progress fire-and-forget
  // background job (job-runner.ts) with no chance to finish or close
  // cleanly. app.close() lets Fastify's own onClose hooks (and open socket
  // handling) run before the process actually exits.
  const shutdown = (signal: NodeJS.Signals) => {
    app.log.info(`${signal} received, shutting down`);
    app
      .close()
      .then(() => process.exit(0))
      .catch((error) => {
        app.log.error(error, "Error during shutdown");
        process.exit(1);
      });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});
