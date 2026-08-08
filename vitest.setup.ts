import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// override:true so these values win over whatever the package-level
// env.ts files load from .env afterward (dotenv's default is to skip
// keys that are already set, which is exactly what lets .env.test's
// three DB URLs take priority while every other .env value still
// falls through normally).
//
// Only handles env loading, deliberately - closing packages/db's pg
// Pool at teardown needs a package-relative import (`@csa/db` doesn't
// resolve from inside packages/db's own test run the way it does for
// a real consumer like apps/api), so each package that needs that
// teardown has its own small vitest.setup.ts alongside this shared one.
const repoRoot = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(repoRoot, ".env.test"), override: true });
