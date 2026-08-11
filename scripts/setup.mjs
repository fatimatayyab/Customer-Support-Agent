// First-time local setup: gets a fresh clone from "just cloned" to
// "ready to run `pnpm dev`" in one command. Deliberately plain Node
// (fs/child_process/crypto only, no new dependency) - this is tooling,
// not infrastructure, and the root package has none today.
//
// What it does, in order:
//   1. Creates .env from .env.example if missing, with real generated
//      secrets instead of the checked-in placeholder text.
//   2. Creates apps/dashboard/.env.local if missing.
//   3. Starts Postgres + Redis via the existing docker-compose.yml.
//   4. Waits for Postgres to actually accept connections.
//   5. Runs the Drizzle migrations.
// Safe to re-run: every step is skipped if its output already exists.

import { randomBytes } from "node:crypto";
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Command built as one string, not a separate args array, deliberately -
// Node warns (DEP0190) about combining shell:true with an args array
// since a caller might expect those args escaped, which they aren't.
// Every call site here passes fixed, hardcoded arguments (never
// user input), so string concatenation is safe in practice, but building
// one string avoids the warning without losing shell:true - still needed
// on Windows to resolve pnpm's/docker's .cmd shims.
function run(command, args) {
  const full = [command, ...args].join(" ");
  console.log(`\n$ ${full}`);
  const result = spawnSync(full, { cwd: repoRoot, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`\n"${full}" failed (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

function generateSecret() {
  return randomBytes(32).toString("base64");
}

function ensureRootEnv() {
  const envPath = join(repoRoot, ".env");
  if (existsSync(envPath)) {
    console.log(".env already exists - leaving it alone.");
    return;
  }
  console.log("Creating .env from .env.example, with real generated secrets...");
  copyFileSync(join(repoRoot, ".env.example"), envPath);
  let contents = readFileSync(envPath, "utf8");
  // Both secrets share the same placeholder text in .env.example - each
  // occurrence gets its own independent, real secret, not a shared one.
  contents = contents.replace(/replace-with-a-real-secret-in-every-environment/g, () => generateSecret());
  writeFileSync(envPath, contents);
}

function ensureDashboardEnv() {
  const envPath = join(repoRoot, "apps", "dashboard", ".env.local");
  if (existsSync(envPath)) {
    console.log("apps/dashboard/.env.local already exists - leaving it alone.");
    return;
  }
  console.log("Creating apps/dashboard/.env.local...");
  writeFileSync(envPath, "NEXT_PUBLIC_API_URL=http://localhost:4000\n");
}

function waitForPostgres() {
  console.log("\nWaiting for Postgres to accept connections...");
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = spawnSync("docker compose exec -T postgres pg_isready -U postgres -d csa_dev", {
      cwd: repoRoot,
      shell: true,
    });
    if (result.status === 0) {
      console.log("Postgres is ready.");
      return;
    }
    if (attempt === maxAttempts) {
      console.error("\nPostgres never became ready. Check `docker compose logs postgres`.");
      process.exit(1);
    }
    sleepSync(1000);
  }
}

// A synchronous, cross-platform 1-second pause between readiness checks -
// Atomics.wait blocks the main thread without spawning a platform-specific
// `sleep`/`timeout` subprocess (which would need different flags on
// Windows vs. POSIX).
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

ensureRootEnv();
ensureDashboardEnv();
run("docker", ["compose", "up", "-d"]);
waitForPostgres();
run("pnpm", ["--filter", "@csa/db", "migrate"]);

console.log(`
Setup complete. Still to do:

1. Add at least one AI key to .env (both are free-tier friendly):
     GEMINI_API_KEY=...   https://aistudio.google.com/apikey   (AI_PROVIDER=gemini is the default)
     ANTHROPIC_API_KEY=... https://console.anthropic.com        (set AI_PROVIDER=anthropic to use it)
   Optional: VOYAGE_API_KEY (https://dash.voyageai.com) if you want to test knowledge-base ingestion/RAG.

2. Start everything:
     pnpm dev

3. Open http://localhost:3000/signup, create a workspace, then Home -> API Keys -> Create.

4. Open the widget dev harness (the URL "pnpm dev" prints for @csa/widget, usually http://localhost:5173),
   click the chat bubble, and paste the API key when prompted.
`);
