---
name: api-endpoint-creation
description: Adding or changing a route in apps/api — the non-obvious mechanics beyond what CLAUDE.md already states as rules.
---

**For:** adding or changing a route in `apps/api`.

**Procedure:**
1. Extend an existing module (`apps/api/src/modules/<domain>/{*.routes,*.service,*.repository}.ts`) before creating a new one.
2. Export the route as `async function <domain>Routes(app)`; register it in `app.ts` **without** `await` (CLAUDE.md §3 — awaiting truncates the plugin chain).
3. One auth mechanism per route — `requireSession` or `requireApiKey`, never mixed on the same route.
4. Any flow spanning more than one module goes through `support-orchestrator.ts` — never call two modules directly from a route.
5. Public-facing or cost-incurring endpoint → add rate limiting (CLAUDE.md §4, pattern in `apps/api/src/rate-limit.ts`).

**Good result looks like:** curled successfully with an allowed role, a blocked role, and a wrong workspace — three real requests, not a typecheck pass.

**Reference:** `apps/api/src/app.ts`, `apps/api/src/modules/auth/require-role.ts`, `apps/api/src/modules/knowledge/knowledge.routes.ts` (fullest example)
