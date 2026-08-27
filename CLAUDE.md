# CLAUDE.md

How Claude Code must behave in this repo — guardrails, not documentation. What/why lives in `docs/00`–`06`; what's built in `docs/07_Phase_Execution_Log.md`; the formally decided production architecture (hosting, scaling, CI/CD, domains) lives in `docs/08_Production_Architecture.md`; future product direction and the Fin/Intercom benchmark comparison live in `docs/09_Fin_Benchmark_And_Product_Roadmap.md`; general engineering principles in `docs/05_Engineering_Bible.md`; recurring-task SOPs in `.claude/skills/`; the team roster in `AGENTS.md` and `.claude/agents/`; feature work is coordinated via `.claude/commands/orchestrator.md`; fixed recurring workflows via Operators, indexed in `.claude/operators/README.md`. Read only what a task needs — don't front-load all docs every session.

---

## 1. Decision Hierarchy

1. User instruction this conversation — flag it first if it contradicts something below, don't silently override or silently refuse.
2. `docs/00`–`06` (approved architecture) → 3. this file → 4. `docs/07` (what's actually built — check before assuming unbuilt) → 5. `docs/09` (approved future direction/roadmap — check before proposing new-feature scope or timing) → 6. existing code patterns → 7. your judgment (lowest precedence; if used for a consequential gap-fill, say so and log it in `docs/07`).

**Ask before proceeding** on anything expensive to reverse (schema shape, auth mechanism, new vendor, tenant isolation) not already settled in `docs/00`–`06` or §2.

---

## 2. Architecture Boundaries (non-negotiable)

- **Support Orchestrator** (`apps/api/src/orchestrator/support-orchestrator.ts`) is the *only* cross-module coordinator. Route handlers call it; never call two modules directly or reimplement orchestration in a route.
- **AI Service** never touches the DB, calls third parties, owns state, or makes business/authorization decisions — data in, structured result out. Same boundary for Knowledge/Integration/Realtime (`docs/03`).
- **External providers behind an interface** (`AiProvider`, `EmbeddingProvider`, `IntegrationProvider`) — no vendor SDK imported outside its module.
- **Tenant isolation — every workspace-owned table needs all four, no exceptions:**
  1. `workspace_id uuid NOT NULL` on the table itself.
  2. RLS policy scoped to `current_setting('app.workspace_id', true)`.
  3. An index touching `workspace_id`.
  4. Accessed only via `withWorkspaceContext()` (`packages/db/src/tenant-context.ts`) — repositories take `ScopedDb`, never raw `db`.

  Only bypass: `auth_resolver` (BYPASSRLS, narrow grants) to resolve a public identifier into a `workspace_id` before tenant context exists — don't widen it or add a second one.
- **Extend, don't restructure** — new channels/providers/integrations extend an existing module/interface, not a new service or a reshaped Orchestrator.

Settled decisions (Drizzle, pnpm, dual RLS+app scoping, stateless JWT, in-process realtime hub, Voyage, pgvector, etc.) aren't to be re-litigated without a strong new reason — rationale in `docs/07`.

---

## 3. Working Conventions

- Extend an existing module/repository/service before creating one; check `docs/07` before assuming something's unbuilt; check `.claude/skills/` for a recurring task's SOP before improvising.
- Repository files (`<entity>.repository.ts`): plain functions taking `ScopedDb`, never a class, never raw `db`.
- Zod-validate every request body at the route boundary. Role checks go through `requireRole()` — never an inline copy.
- Errors: `throw` an `AppError` subclass; the central handler shapes the response, route handlers don't format one themselves.
- `noUncheckedIndexedAccess` is on — use `assertDefined()`, don't silence with `!`.
- Migrations: `pnpm db:generate`, inspect the SQL, then `pnpm db:migrate` — never apply blind.
- No comments restating code — only non-obvious *why*.
- Wait for a second real use case before extracting an abstraction.
- Dashboard routes: session-cookie auth (`requireSession`). Widget routes: API-key auth (`requireApiKey`). Never mix the two.
- Never `await` an individual `app.register()` call in `app.ts` — it silently truncates the plugin chain (including `setErrorHandler`). Never register `@fastify/cors` twice — one global preflight route, one registration.

---

## 4. Security

- Never trust client input; re-verify ownership of any client-supplied ID against the DB, scoped to the workspace.
- Argon2 for passwords, SHA-256 for API keys — don't swap. Secrets shown once at creation, never logged, never re-displayed.
- New public-facing or cost-incurring endpoint → add rate limiting (see `apps/api/src/rate-limit.ts` for the pattern).
- Check `git status`/`git diff` for `.env`-shaped content before every commit — never commit a real secret.
- Workspace signup is invite-gated (`pnpm invite <email>`) — don't hand-craft around it.

---

## 5. Testing & Verification

- Real-DB suites exist for the highest-risk surface (`packages/db/src/tenant-isolation.test.ts`, `support-orchestrator.test.ts`) — run via `pnpm --filter @csa/db test` / `pnpm --filter @csa/api test`, no mocks. Reuse `apps/api/src/test-support/` fakes at the provider-interface boundary, never at the service layer.
- Elsewhere, coverage isn't exhaustive: `pnpm -r run typecheck` clean is necessary but not sufficient — back it with a real curl/browser check of the path. Don't declare a feature done off types alone.
- Any change touching a tenant table or new endpoint: two-workspace cross-check (workspace B can't see workspace A's data).
- Any UI change: drive it in a real browser, screenshot it, check the console.

---

## 6. Definition of Done

- [ ] Typecheck + lint clean across affected packages.
- [ ] Tests pass (existing suite) or real execution per §5.
- [ ] Schema changes: migration generated, inspected, applied; RLS + index present (§2).
- [ ] Tenant isolation re-confirmed if workspace-scoped data is touched.
- [ ] No Orchestrator bypass, no AI-Service business logic, no direct vendor calls outside a provider module.
- [ ] No dead code, no duplicated logic, no secrets in the diff.
- [ ] `docs/07` updated if this completes or meaningfully advances a phase.
- [ ] Architecture & Readiness Review Operator run for non-trivial changes (`.claude/operators/architecture-readiness-review/`).
- [ ] **Nothing committed unless explicitly asked, this turn** — prior approval doesn't carry forward.

---

## 7. Communication

- Act as a senior engineer — challenge weak ideas, surface tradeoffs, don't execute silently when something looks off.
- Conflict with approved docs or established pattern → say so before proceeding, don't guess.
- Reversible + well-justified → proceed and state reasoning. Expensive-to-reverse + ambiguous → ask first (§1).
- Be concise; state results, don't narrate process. Report review findings plainly rather than silently fixing or dropping them.

---

## 8. Session Bootstrap

Inspect first, run what's relevant — don't run the full stack for a trivial or read-only task.

- Always: skim `docs/07`'s last 1-2 entries, `git log --oneline -5` + `git status` — don't assume prior conversation state matches disk.
- If the task touches the DB/API: `pnpm docker:up` (Postgres 5433, Redis) and `pnpm -r run typecheck` before changing anything.
- Before considering DB/API work done: `pnpm --filter @csa/db test` / `--filter @csa/api test` (first run: `test:db:setup`).
- RAG/knowledge work: confirm `VOYAGE_API_KEY` is set.

## 9. Response Reporting
After completing a substantive task, end the response with a concise **Summary** containing:
- What was done
- Important decisions/findings
- Anything requiring user action or approval

Keep it to 2–4 bullets. Do not repeat the detailed report.
For trivial actions or simple questions, skip the summary.