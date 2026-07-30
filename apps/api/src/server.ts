import { buildApp } from "./app.js";
import { env } from "./config/env.js";

async function main() {
  const app = await buildApp();

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
}

main().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});
