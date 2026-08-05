# SKILLS.md — Engineering Playbook

Step-by-step SOPs for recurring work in this repo. Pure procedure — the *why* lives in `CLAUDE.md` and `docs/00`–`06`; this file doesn't repeat it. If a step here conflicts with `CLAUDE.md`, `CLAUDE.md` wins.

**Principle:** extend an existing pattern before introducing a new one. When two approaches would both work, pick the one already used elsewhere in this codebase — consistency beats cleverness.

Assume before starting any skill: Docker is up (`pnpm docker:up`), `pnpm -r run typecheck` is clean, `docs/07_Phase_Execution_Log.md` has been skimmed for current status.

---

## 1. Multi-Tenant Data Isolation & Database Review

**Use when:** touching any workspace-owned table, or auth/identification code.

**Steps:**
1. Table has `workspace_id uuid NOT NULL references workspaces.id`.
2. `pgPolicy` (using/withCheck on `current_setting('app.workspace_id')`) + `.enableRLS()` present.
3. An index touches `workspace_id` (composite if the query shape needs it).
4. Every repository function takes `ScopedDb` as its first param — never the raw `db` export.
5. The call site wraps in `withWorkspaceContext(workspaceId, cb)`.
6. Vector-search queries add an explicit `workspaceId` filter in the query itself — HNSW doesn't compose reliably with RLS alone.
7. Don't add a new BYPASSRLS path outside `auth-resolver-client.ts`. Extending it: grant only the specific columns needed — including any used only in a `WHERE` clause, not just returned ones.
8. A lookup by ID into another workspace's resource returns 404, not 403 — don't reveal existence. Exception: if the caller already holds a secret token for that exact resource (e.g. an invitation), a specific error is fine — there's no confidentiality benefit to vagueness there.

**Verify:** two-workspace cross-check — confirm workspace B cannot read or write workspace A's rows, and that status codes follow the 404 rule above.

**Reference:** `packages/db/src/tenant-context.ts`, `packages/db/src/auth-resolver-client.ts`, `packages/db/src/schema/knowledge-chunks.ts` (pattern example)

---

## 2. API Endpoint Creation (`apps/api`)

**Use when:** adding or changing a route.

**Steps:**
1. Extend an existing module (`apps/api/src/modules/<domain>/{*.routes,*.service,*.repository}.ts`) before creating a new one.
2. Export the route as `async function <domain>Routes(app)`; register it in `app.ts` **without** `await`.
3. Pick one auth mechanism — `requireSession` (dashboard) or `requireApiKey` (widget). Never mix on one route.
4. Gate mutations with `requireRole(role, allowedRoles, message)` — don't write a second inline check.
5. Validate the body with `schema.parse(request.body)`, uncaught.
6. Throw `AppError`/`AuthError`/`ForbiddenError`/`NotFoundError` — don't format responses in the handler.
7. Any flow spanning more than one module goes through `support-orchestrator.ts` — never call two modules directly from a route.
8. Use `request.log`, never `console.log`.

**Verify:** curl the route with an allowed role, a blocked role, and a wrong workspace.

**Reference:** `apps/api/src/app.ts`, `apps/api/src/modules/auth/require-role.ts`, `apps/api/src/errors.ts`, `apps/api/src/error-handler.ts`, `apps/api/src/modules/knowledge/knowledge.routes.ts` (fullest example)

---

## 3. Database Schema & Migrations (`packages/db`)

**Use when:** adding or changing a table, column, index, or RLS policy.

**Steps:**
1. One entity (+ its enums) per file: `packages/db/src/schema/<entity>.ts`, exported from `index.ts`.
2. Apply Skill 1's `workspace_id`/RLS/index pattern.
3. A concept that doesn't fit an existing table's invariants gets its own table — not a nullable hack column.
4. Derive insert types with `Pick<typeof table.$inferInsert, "...">`.
5. `pnpm db:generate` → read the generated SQL before applying, especially RLS/index/custom-type clauses.
6. `pnpm db:migrate` to apply.
7. Assert a single-row `RETURNING` with `assertDefined()` — never a bare `!`.
8. If two requests could genuinely race to insert the same logical row, use a partial unique index — an app-level check-then-write is not sufficient.
9. When detecting a unique-violation, check both `error.code` and `error.cause?.code` — Drizzle wraps the raw driver error under `.cause`.

**Reference:** `packages/db/src/schema/vector-type.ts`, `packages/db/migrations/`

---

## 4. Knowledge Source Ingestion ("Learn")

**Use when:** adding an ingestible content type, or changing chunking/embedding.

**Steps:**
1. Place logic in the right file under `apps/api/src/modules/knowledge/`: `knowledge.routes.ts` / `.service.ts` / `*.repository.ts` / `embedding-provider.ts` / `chunker.ts` / `text-extraction.ts` / `website-extraction.ts`.
2. A new source type is a plain extraction function, not a new provider interface.
3. Reject an unimplemented type explicitly with a typed error — never silently half-support it.
4. Fast/CPU extraction (file parsing) → synchronous, before insert. Slow/network work (embedding, fetch) → un-awaited background job (`pending` → `processing` → `completed`/`failed`).
5. Batch calls to paid/rate-limited APIs sequentially, capped — never `Promise.all`.
6. Any URL-fetching step needs a timeout **and** a streamed byte-size cap (abort mid-stream, don't buffer then check).
7. Keep `embedDocuments()`/`embedQuery()` as separate `EmbeddingProvider` methods.
8. Any endpoint accepting a URL needs the SSRF guard (reject `localhost`/`.local`/private IPs before fetching).

**Verify:** a real source of the new type reaches `completed`, and a real search query retrieves it, ranked correctly.

**Reference:** `apps/api/src/modules/knowledge/knowledge.service.ts`, `chunker.ts`, `website-extraction.ts`, `text-extraction.ts`

---

## 5. AI Provider Management ("Understand / Answer")

**Use when:** adding a provider, changing prompts, or adjusting confidence/escalation.

**Steps:**
1. New provider = one file in `modules/ai/providers/` implementing `AiProvider` + one `case` in `ai.service.ts`'s `createAiProvider()`. Nothing else should need to change.
2. `provider`/`model`/`promptVersion` are set by the provider itself inside its result — never assumed by the caller.
3. Use forced tool/function-calling against the shared schema in `prompts/support-reply.prompt.ts` — not prompted JSON.
4. Prompt text/schema lives in `modules/ai/prompts/`, never inline in a provider file. Bump the `*_PROMPT_VERSION` constant on any meaningful wording/schema change.
5. Tuning values live in `ai.config.ts` — don't inline magic numbers.
6. Cap any history sent to a provider with `MAX_HISTORY_MESSAGES`.
7. Preserve the retrieval floor: below `MIN_RELEVANCE_SIMILARITY`, skip the provider call entirely — don't rely on prompt wording alone.
8. Show the model's own reply even when low-confidence or self-escalating. Only zero-relevant-chunks and provider failure get a hardcoded fallback.

**Verify:** a real call covering a grounded question, an off-topic question, and an induced provider failure — confirm `messages.metadata.provider`/`promptVersion` are recorded, and that citations only come from the calling workspace's own knowledge.

**Reference:** `apps/api/src/modules/ai/ai-provider.ts`, `ai.service.ts`, `ai.config.ts`, `providers/*.ts`

---

## 6. External Integration Action ("Act")

**Use when:** adding an action to an existing provider, or a new provider.

**Steps:**
1. Name the interface method for the business capability, not the vendor (`lookupContact`, not `getHubSpotContact`). Result types are vendor-neutral fields, not a passthrough of the vendor's raw response.
2. Confine vendor knowledge to the provider implementation file and the audit log's `provider` field — route/Orchestrator stay vendor-neutral.
3. `integration.service.ts` is the only place selecting the concrete provider class (per-workspace, not env-selected).
4. Encrypt credentials via `jose` JWE (`credential-crypto.ts`) — don't hand-roll crypto.
5. Verify credentials before storing them.
6. Wrap credential-decryption **and** the provider call in one try/catch feeding the audit log.
7. Log every attempt, success or failure, to `integration_action_logs` (FK `ON DELETE SET NULL`, not cascade).
8. Decide deliberately per action whether the result is customer-visible — default to agent-only (`conversation_notes`), never a broadcast message, unless there's a stated reason.
9. Don't build a generic multi-provider connector before a second concrete provider exists.

**Verify:** a bad credential produces a real vendor-side error (not a mock); credential encryption round-trips correctly; a failed action produces no `conversation_notes` entry.

**Reference:** `apps/api/src/modules/integrations/integration-provider.ts`, `integration.service.ts`, `credential-crypto.ts`, `providers/hubspot-integration-provider.ts`

---

## 7. Dashboard Feature Development (`apps/dashboard`)

**Use when:** adding a page or feature.

**Steps:**
1. Route = `app/<route>/page.tsx`, `"use client"`.
2. All API calls go through `apiFetch<T>()` in `lib/api.ts` — never call `fetch` directly.
3. Never manually set `Content-Type` — `apiFetch` already omits it for bodyless requests and `FormData`.
4. Catch `ApiError` specifically to surface a real backend message vs. a network failure.
5. Poll for list/status views (match the cadence of the page you're extending); use `lib/agent-console-ws-client.ts` for anything needing live push.
6. Gate role-restricted UI client-side **in addition to**, never instead of, the backend check.

**Reference:** `apps/dashboard/lib/api.ts`, `apps/dashboard/app/conversations/[id]/page.tsx`, `apps/dashboard/lib/agent-console-ws-client.ts`

---

## 8. Embeddable Widget Development (`apps/widget`)

**Use when:** changing widget UI, connection handling, or embed mechanics.

**Steps:**
1. Mount inside the existing Shadow DOM root (`main.tsx`) — never `document.body` directly.
2. Weigh bundle-size cost before adding any dependency.
3. Keep the connection lazy — connect on first bubble-open, not on load.
4. Keep the ticket handshake for WS auth (`POST /widget/session` → `GET /widget/ws?ticket=...`). Never put the API key in the WS URL.
5. Persist `customerId`/`conversationId` via `storage.ts` on the host page's own origin.
6. Keep the build a single IIFE (`vite.config.ts`: `formats: ["iife"]`, `cssCodeSplit: false`) — one `<script>` tag, no chunking.
7. No Playwright coverage exists for the widget yet — say so explicitly if verification was manual only.

**Verify:** build first, then verify against the **built** bundle via `example/index.html` (not the dev server) — bubble open/close, message send/receive, and the typing indicator all work.

**Reference:** `apps/widget/src/main.tsx`, `ws-client.ts`, `vite.config.ts`, `example/index.html`

---

## 9. Bug Investigation & Log Triage

**Use when:** investigating a reported bug or unexpected error.

**Steps:**
1. Reproduce against the real running system (curl/browser) — a clean typecheck is not proof of correctness.
2. Bug appears only in the browser, not curl → suspect a header/body-shape issue (`Content-Type`, `FormData`) first.
3. Read `request.log` output and inspect the DB directly — there's no tracing/metrics system yet.
4. Client sees a generic 500 → check whether the throwing code uses a plain `Error` instead of `AppError`.
5. Suspected tenant leak → run the two-workspace cross-check immediately (Skill 1), don't reason about it abstractly.
6. Suspected race → reproduce with genuinely concurrent requests, not sequential ones.
7. Unique-violation not caught as expected → check `error.cause?.code`, not just `error.code`.
8. Check `docs/07_Phase_Execution_Log.md` for the module before deep-diving — it may already be documented.

**Rule:** fix the root cause. Don't add a try/catch that just silences the symptom.

**Reference:** `apps/api/src/error-handler.ts`

---

## 10. Production Verification & Smoke Testing

**Use when:** before calling any feature done — there is no automated test suite, so this is the actual bar. This is the default verification checklist every other skill's "Verify" step builds on.

**Steps:**
1. `pnpm -r run typecheck` clean across affected packages.
2. `pnpm docker:up`; confirm Postgres (port 5433) and Redis are healthy.
3. Start the relevant app(s): `pnpm dev:api` / `dev:dashboard` / `dev:widget`.
4. Exercise the real path:
   - API-only → curl, success + at least one failure/edge case.
   - Realtime → a real WS client, not just the HTTP handshake.
   - UI → real browser, console + network tab clean.
5. Two-workspace cross-check (Skill 1) for any workspace-scoped table or new endpoint.
6. Confirm migration generated/inspected/applied if schema changed.
7. Remove any test data created during verification.
8. Re-read the diff once, specifically for security/tenant-isolation/race issues, before calling it done.

**Reference:** `CLAUDE.md` §17, §19

---

## 11. Commit & Release Workflow

**Use when:** the user has explicitly asked, this turn, for a commit. A prior approval doesn't carry forward.

**Steps:**
1. Complete Skill 10's verification pass first.
2. Run the Definition of Done checklist (`CLAUDE.md` §19).
3. Check `git status`/`git diff` for anything `.env`-shaped. Stage specific files — never `git add -A`/`.`.
4. Write the commit message in this repo's style: a short feature/milestone title (see `git log --oneline` for examples), a prose body on what+why, ending with:
   ```
   Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
   ```
5. One commit per coherent unit of work — don't bundle unrelated changes.
6. Update `docs/07_Phase_Execution_Log.md` in the same unit of work if this completes/advances a phase.
7. Only `git push` when explicitly asked — separately from the commit ask.
8. Pre-commit hook fails → fix and create a **new** commit. Never `--amend` (the failed commit never happened).

**Reference:** `CLAUDE.md` §14, §19, §22
