# CLAUDE.md

**Engineering handbook for Claude Code working in this repository.** Governs *how* to work here — conventions, guardrails, process. Not product documentation.

For *what* the product is and *why* it's architected this way: `docs/00`–`docs/06`. For what's actually been built, verified, and decided: `docs/07_Phase_Execution_Log.md`. Keep this file short enough to actually be read — when it starts duplicating those docs, shorten it and point instead.

---

## 1. Source of Truth & Decision Hierarchy

When sources disagree, resolve in this order:

1. **Explicit instruction from the user, this conversation.** Highest precedence — but if it contradicts something below, say so before proceeding. Don't silently override approved architecture, and don't silently refuse — surface the conflict.
2. **`docs/00`–`docs/06`** — approved product/architecture docs. Source of truth for *what* and *why*.
3. **This file** — source of truth for *how*: conventions, process, guardrails.
4. **`docs/07_Phase_Execution_Log.md`** — record of what's actually built. Check before assuming something is unbuilt or undecided.
5. **Existing code patterns** — follow established precedent unless there's a documented reason not to.
6. **General best practice / judgment** — lowest precedence. If a consequential gap-fill, say so and record it in `docs/07`.

If a call is expensive to reverse (schema shape, auth mechanism, a new vendor, anything touching tenant isolation) and isn't already settled in `docs/00`–`06` or §2 below — check with the user rather than guessing.

---

## 2. Core Architecture Rules

The non-negotiables. Everything else in this file elaborates on these.

- **Modular monolith.** One deployable API (`apps/api`), organized into feature modules — designed so a future service split wouldn't require a rewrite, not to justify doing it now.
- **The Support Orchestrator is the only coordinator across modules.** Route handlers call it; they never reimplement orchestration logic or call two modules directly themselves (§9).
- **The AI Service never touches the database, calls third parties, owns state, or makes business/authorization decisions.** It receives plain data and returns a structured result — nothing else (§10).
- **No module bypasses the Orchestrator to call another module directly.**
- **Every tenant-owned table is isolated at two independent layers** — app-level scoping (`withWorkspaceContext`) and RLS — never one alone (§8).
- **External providers sit behind an interface.** AI, embeddings, and future integrations are swappable implementations; nothing outside their module imports a vendor SDK directly.
- **Extend, don't restructure.** New channels, providers, integrations, and actions are added by extending an existing module/interface — not by reshaping the Orchestrator's core shape or splitting into microservices preemptively.

---

## 3. Before Writing Code

- Read the relevant module (and its neighbors) before adding to it — check whether an existing repository/service/route already owns the responsibility.
- Extend an existing module before creating a new one. A new top-level module is for a genuinely new domain, not a sub-concern of an existing one.
- Match existing patterns — naming, file layout, error handling — over introducing a new one. Consistency beats cleverness.
- Don't build an abstraction until a second real use case needs it (§16).
- Check `docs/07` for current phase status before assuming what's built — don't rely on memory of a prior session.
- If the change touches schema shape, auth, tenant isolation, or a new vendor, confirm with the user before implementing (§1).

---

## 4. Project Overview

AI-powered customer support SaaS (multi-tenant: "Workspace" = tenant). A business embeds a chat widget; customers chat with an AI grounded in that business's knowledge base; conversations can hand off to a human agent. Full detail: `docs/00_Product_Requirement_Specification.md`. Current phase status: `docs/07`.

---

## 5. Technology Stack (as installed — check `package.json` if this drifts)

| Layer | Choice | Notes |
|---|---|---|
| Monorepo | pnpm workspaces (`pnpm@10.33.0`, Node ≥20) | Strict dependency linking — a package must declare a dependency directly to import it, even if hoisted transitively. |
| API | Fastify 5 (`apps/api`) | Plugins: `@fastify/cookie`, `@fastify/cors`, `@fastify/websocket`. |
| DB access | Drizzle ORM + drizzle-kit (`packages/db`) | Schema-as-code, including RLS policies (`pgPolicy`). No native pgvector column type — see `vector-type.ts`'s `customType`. |
| Database | PostgreSQL 16 + pgvector (Docker, host port **5433** — 5432 is occupied by a native install) | Roles: `postgres` (superuser, migrations), `app_user` (NOSUPERUSER/NOBYPASSRLS, normal queries), `auth_resolver` (BYPASSRLS, narrow column grants, pre-tenant-context lookups only — §8). |
| Cache/pub-sub | Redis (Docker, port 6379) | Provisioned, not yet used — reserved for the real-time hub once it runs across more than one API instance. |
| Auth | `jose` (JWT), `@node-rs/argon2` (passwords), SHA-256 (API keys) | Session cookies for dashboard (7-day, httpOnly, can't be force-revoked before expiry — accepted tradeoff). Short-lived (60s) single-purpose tickets for the widget's WebSocket handshake. |
| Validation | Zod, everywhere input enters the system | Env vars, route bodies, WebSocket message shapes. Route-level parsing throws `ZodError`, caught centrally (§13). |
| Embeddings | Voyage AI (`voyage-3-lite`, 512 dims) behind an `EmbeddingProvider` interface | Anthropic's recommended RAG pairing (Claude has no embeddings API). Swap the implementation, not the interface, if that changes. |
| Dashboard | Next.js 15 + React 19 + Tailwind v4 | Client-rendered (`"use client"` everywhere) — no SSR benefit needed for a login-gated admin panel yet. |
| Widget | Preact + Vite, single IIFE bundle, Shadow DOM mount | Bundle size matters — it loads on someone else's website. Weigh shipped KB before adding a dependency. |
| Real-time | `@fastify/websocket` | In-process conversation hub (`Map`), not Redis-backed — correct for one API instance, not horizontal scaling. |

---

## 6. Folder Structure

```
apps/
  api/src/
    modules/<domain>/        # auth, workspace-identification, workspaces, users,
                              # customers, conversations, realtime, knowledge, ...
      <entity>.repository.ts # plain async functions, ScopedDb only, no classes
      <domain>.service.ts    # orchestration within a module, calls repositories
      <domain>.routes.ts     # Fastify plugin: export async function xRoutes(app)
    orchestrator/
      support-orchestrator.ts  # THE Support Orchestrator. Singular. See §9.
    config/env.ts             # Zod-validated env, parsed once at import
    errors.ts, error-handler.ts, assert.ts   # shared, cross-cutting
    app.ts, server.ts         # app.ts builds the Fastify instance; server.ts boots it
  dashboard/app/<route>/page.tsx   # Next.js App Router, client components
  widget/src/                      # Preact source, builds to dist/widget.js
packages/
  db/src/
    schema/<entity>.ts    # one entity (+ its enums) per file, RLS policy inline
    client.ts             # app_user-scoped db export — never import this raw into a repository
    tenant-context.ts      # withWorkspaceContext() — the only way to get a ScopedDb
    auth-resolver-client.ts  # the narrow BYPASSRLS lookups, nothing else
  shared/src/              # types shared between apps/api and apps/dashboard
docs/00-06                 # approved architecture/product docs — source of truth for WHAT/WHY
docs/07                    # phase execution log — living record of WHAT'S BUILT
infra/postgres/init/       # local-dev-only role bootstrap SQL
```

A new domain gets a new folder under `apps/api/src/modules/`. Don't add a top-level module for a sub-concern of an existing one.

---

## 7. Service Boundaries

| Component | Owns | Never does |
|---|---|---|
| **Support Orchestrator** | Business logic, workflow, application state, conversation lifecycle | Contain AI logic; call third-party APIs directly |
| **AI Service** (not yet built) | Intent understanding, response generation, tool selection, confidence scoring | Business rules, auth decisions, own state, touch the DB, call third parties directly |
| **Knowledge Service** (`modules/knowledge`) | Ingestion, chunking, embedding, semantic search | Decide *when* to retrieve for a conversation — that's the Orchestrator's call |
| **Integration Service** (not yet built) | The only thing that talks to external business systems (Shopify, Stripe, etc.), normalizes responses | Being called by anything other than the Orchestrator |
| **Realtime hub** (`modules/realtime`) | Connection tracking, message/typing fan-out | Persistence — it's a transport layer, not a data store |

The Orchestrator is the only thing that talks to more than one of these in a single flow.

---

## 8. Tenant Isolation Rules (non-negotiable)

Every table storing workspace-owned data needs **all four**:

1. `workspace_id uuid NOT NULL references workspaces.id` — denormalized onto the table itself even if reachable via a join; RLS and most queries need it directly on the row.
2. An RLS policy: `.enableRLS()` + `pgPolicy(..., using/withCheck: workspace_id = current_setting('app.workspace_id', true)::uuid)`.
3. **An index touching `workspace_id`** — plain, or composite for a real query shape (e.g. `(workspace_id, created_at)`). Missed for two phases before a review caught it — don't repeat that.
4. Exclusively accessed through **`withWorkspaceContext(workspaceId, callback)`** (`packages/db/src/tenant-context.ts`). Repository functions take a `ScopedDb`, never the raw `db` export — no code path queries a tenant table without first committing to a `workspaceId`.

The one deliberate exception: resolving a public identifier (API key, workspace slug) into a `workspace_id` *before* tenant context exists, via the narrow `auth_resolver` role (`packages/db/src/auth-resolver-client.ts`) — BYPASSRLS, but granted `SELECT` on only the specific columns it needs. **Don't add new BYPASSRLS access paths without this same narrowness**; extend `auth-resolver-client.ts`'s grants rather than creating a new bypass role.

Any new tenant table or endpoint gets a two-workspace cross-check before it's called done (§17).

---

## 9. Support Orchestrator Responsibilities

`apps/api/src/orchestrator/support-orchestrator.ts` is the literal implementation of the System Architecture's Support Orchestrator. It:

- Receives requests, coordinates modules, maintains conversation state, enforces business rules, decides workflow, logs platform events.
- Is implemented as **plain exported functions**, not a class — no cross-call state to manage. Don't reach for a class/factory unless the problem genuinely needs instance state.
- Is the *only* place that combines more than one module in a single flow. Route handlers call it; they don't reimplement its job.
- Never trusts client-supplied IDs at face value — every ID (customerId, conversationId) is looked up against the DB, scoped to the workspace, before use. See `initiateConversation`'s handling of a resumed `conversationId` for the pattern.

---

## 10. AI Service Responsibilities (not yet built)

What this module must and must never do is already covered by §2's Core Architecture Rules and §7's Service Boundaries table — don't re-list it here once it's built. Two things worth deciding ahead of time: it will live at `apps/api/src/modules/ai/`, built behind a provider interface (mirroring `EmbeddingProvider`) even though Claude is the only planned implementation. Confidence-scoring methodology is an open question — decide it deliberately when the module is built, and note the choice in `docs/07`.

---

## 11. Database Guidelines

- Schema in `packages/db/src/schema/<entity>.ts` — one entity (and its enums) per file. RLS policy inline in the table's third-argument array, `.enableRLS()` chained after.
- Repository input types: derive from `Pick<typeof table.$inferInsert, "...">` rather than hand-duplicating field lists.
- `INSERT ... RETURNING` on a single-row insert always yields one row — assert it with `assertDefined()` (`apps/api/src/assert.ts`), don't silence `noUncheckedIndexedAccess` with a bare `!`.
- Migrations: `pnpm db:generate`, then inspect the generated SQL before `pnpm db:migrate` — don't apply blind, especially for RLS policies, custom types, or indexes.
- Don't add speculative columns for an unbuilt phase. Nullable columns are cheap to add exactly when needed.
- When the domain model (`04_Domain_Model.md`) already specifies a full enum lifecycle, use it even if only one value is exercised today — extending an enum later is easy, renaming/removing values is not.

---

## 12. API Design Guidelines

- Route files export a single Fastify plugin function, registered in `app.ts` without an individual `await` — a real footgun (§20).
- Two identification mechanisms, never mixed: session cookie + `requireSession` for dashboard routes, API key header + `requireApiKey` for widget routes. Both attach to `request.workspaceId`/`request.sessionUser` (`types/fastify.d.ts`).
- Role checks use the shared `requireRole()` helper (`modules/auth/require-role.ts`), not an inline per-route check.
- CORS: widget routes are open-origin, no credentials (embedded on arbitrary third-party sites, authenticates via header). Dashboard routes are locked to `DASHBOARD_ORIGIN`, credentials on. One `@fastify/cors` registration with a per-request delegator branching on path prefix — registering twice collides on its global preflight route.
- Validate every request body with Zod at the route boundary — no hand-written field-by-field checks.
- A WebSocket can't set custom headers on its handshake — a new realtime feature needing auth uses the same short-lived-ticket pattern (`widget-ws-ticket.ts`), not a long-lived credential in the URL.

---

## 13. Error Handling & Logging

- Error hierarchy in `errors.ts`: `AppError` (base, carries status) → `AuthError` (401), `ForbiddenError` (403), `NotFoundError` (404). Domain-specific errors extend `AppError` and live near their domain unless generic enough for `errors.ts`.
- One central handler (`error-handler.ts`) decides response shape: `ZodError` → 400 with issues, `AppError` → its own status + message, anything else → logged server-side, generic 500 to the client. Route handlers `throw`; they don't format responses themselves.
- Only throw messages safe for the caller to see — dashboard/admin routes can be more specific than customer-facing ones.
- Use `request.log` (Fastify's request-scoped pino logger) in request handlers, not `console.log`. Standalone scripts (`migrate.ts`, etc.) use `console.log`/`console.error` directly.
- Never log secrets — passwords, raw API keys, session tokens, ticket values.
- No structured error tracking/tracing/metrics exist yet (known gap, `docs/07`).

---

## 14. Security Principles

- Never trust client input — validate at the boundary (Zod), re-verify ownership of any client-supplied ID against the DB scoped to the workspace.
- Every request identifies its workspace before any business logic runs (§8).
- Match hash cost to secret entropy: slow/memory-hard (Argon2) for human-chosen passwords, fast (SHA-256) for already-high-entropy API keys — don't swap these.
- Secrets are hashed at rest; the raw value is shown once, at creation, never again.
- **No rate limiting exists anywhere yet** (login, signup, WebSocket messages, ingestion) — known, accepted gap. Note whether a new public-facing or cost-incurring endpoint needs it before shipping.
- Any new BYPASSRLS access path must be as narrow as `auth_resolver`'s — specific columns, specific tables, documented inline.
- Never commit a real secret. Check `git status`/`git diff` for `.env`-shaped content before every commit, even when the filename looks safe.

---

## 15. RAG Implementation Principles

- Chunking is character-based (not tokenizer-based) — a deliberate, dependency-free proxy. Don't add a tokenizer dependency without a real quality problem demanding it.
- Embedding calls are batched (`MAX_BATCH_SIZE`, sequential not parallel) against provider limits — cost and rate-limit exposure controlled deliberately. Follow this pattern for any new call to a per-item-priced external API.
- `embedDocuments` vs `embedQuery` are separate methods — Voyage's (and likely any future provider's) asymmetric `input_type` handling measurably affects retrieval quality.
- Retrieval is a standalone capability (`knowledge.service.ts`) the Orchestrator calls — not embedded inside the AI Service. Fetch-then-generate as two distinct, Orchestrator-coordinated steps.
- pgvector's HNSW index doesn't combine with a `workspace_id` filter as cleanly as a btree would (documented in `knowledge-chunks.ts`) — worth remembering if search results ever look suspiciously short.
- Ingestion source types are declared in the schema enum ahead of being built (`pdf`, `docx`, `website`) but rejected explicitly (`UnsupportedSourceTypeError`) until implemented. Don't silently half-support a type.

---

## 16. Coding Standards & Naming

- **Wait for the second use before extracting an abstraction.** `requireRole()` stayed inline until a second call site needed the identical check. Don't generalize speculatively.
- Files: kebab-case. Repository files: `<entity>.repository.ts`, plain functions (`insertX`, `getXById`, `listXs`, `updateXStatus`, `deleteX`) — no repository classes. Service files: `<domain>.service.ts`. Route files: `<domain>.routes.ts`.
- Names describe business concepts (`Workspace`, `Conversation`, `SupportOrchestrator`) — never `Helper`, `Utils`, `Manager`, `Misc`.
- `noUncheckedIndexedAccess` is on — handle `T | undefined` properly (`assertDefined()` for guaranteed-non-empty cases), don't silence it with `!`.
- Comments explain non-obvious *why* — a constraint, a workaround, an invariant — never restate what the code already says.

---

## 17. Testing Expectations

**No automated test suite exists yet** — a known, prioritized gap. Priority order when one is introduced: the Orchestrator and the tenant-isolation boundary first, since a regression there is a cross-tenant data leak — the worst bug class this system can have.

Until then, the interim bar for "verified" is real execution, not just `tsc`:

- `pnpm -r run typecheck` (or targeted `--filter`) clean across every affected package — necessary, not sufficient.
- An actual API call (curl) or browser check (Playwright) exercising the real path — don't declare a feature done off types alone.
- Any change touching a tenant table or a new endpoint: a two-workspace cross-check (workspace B genuinely cannot see workspace A's data).
- Any UI change: drive it in a real browser, screenshot it, check the console for errors.

---

## 18. Documentation Expectations

- `docs/00`–`docs/06` are approved architecture/product docs — edit only for a deliberate, user-directed architectural change, and flag the conflict first.
- `docs/07_Phase_Execution_Log.md` is the living record — append what was built, decisions made and why, and what was verified, as part of finishing a phase, not as an afterthought.
- Don't write speculative documentation for unbuilt features beyond what `00`–`06` already capture.
- Code comments follow §16 — no restating, only non-obvious why.

---

## 19. Definition of Done

- [ ] Typechecks across every affected package (`pnpm -r run typecheck`).
- [ ] Lint passes on changed files.
- [ ] Tests pass if a suite exists for the touched area; if none exists, real execution per §17 (API smoke test minimum, browser check for anything UI-facing).
- [ ] Schema changes: migration generated, inspected, applied; RLS + index present on any new tenant table (§8).
- [ ] Tenant isolation re-confirmed (two-workspace cross-check) if the change touches workspace-scoped data.
- [ ] Complies with §2's Core Architecture Rules — no Orchestrator bypass, no business logic in the AI Service, no direct vendor calls outside a provider module.
- [ ] No dead code, no duplicated logic — an existing module/service checked before adding a new one.
- [ ] No secrets in the diff.
- [ ] `docs/07` updated if this completes or meaningfully advances a phase.
- [ ] Nothing committed unless the user explicitly asked for it *in this instance* — an earlier commit approval doesn't carry forward.

---

## 20. Never Do These

Anti-patterns already hit and fixed once — each is a rule now, not just a story:

- **Don't `await` individual `app.register()` calls in `app.ts`.** Fastify's `register()` returns a thenable; awaiting it triggers an implicit early boot that silently skips everything registered after, including `setErrorHandler`. Register synchronously — the real boot happens once, in `server.ts`'s `app.listen()`.
- **Don't register `@fastify/cors` twice.** It installs one global preflight `OPTIONS` route; a second registration collides. One registration, a per-request delegator.
- **Don't ship a new tenant table without an index touching `workspace_id`.** RLS makes queries correct, not fast — a missing index means a scan that grows with total platform data.
- **Don't add a role-gated mutation route without checking for `requireRole()` first.** A second inline copy is exactly the duplication the shared helper prevents.
- **Don't send an unbounded batch to a paid external API.** Cap it and batch sequentially, not `Promise.all`.
- **Don't put a long-lived credential in a URL or query string.** Use a short-lived, single-purpose ticket exchange if the transport can't carry a header.
- **Don't build a Postgres role with `BYPASSRLS` broader than it needs.** `auth_resolver` is narrow on purpose — specific columns, specific tables, specific use case.
- **Don't bypass the Orchestrator to wire two modules together directly.** If a route needs Knowledge + AI in one flow, that composition belongs in the Orchestrator, not the route handler.

---

## 21. Settled Decisions (don't re-litigate without a strong new reason)

| Decision | Why |
|---|---|
| Drizzle over Prisma | Can express RLS policies as part of the schema; Prisma can't |
| pnpm over npm/yarn | Stricter dependency boundaries, no phantom deps |
| App-layer scoping + RLS (dual layer), not RLS alone | Convenient-but-fallible layer + safe-but-silent layer, together |
| Stateless JWT sessions, not a sessions table | Simpler, scales horizontally for free; accepted tradeoff: can't force-revoke |
| WebSocket + ticket handshake, not raw API key in URL | Avoids a long-lived secret in logs/history |
| In-process realtime hub, not Redis pub/sub yet | One API instance today; swap is scoped to one file when needed |
| Full conversation-status lifecycle enum, not a shorthand subset | Matches approved Domain Model; avoids a rename when finer states are needed later |
| Voyage AI for embeddings, not OpenAI | Anthropic's own recommended RAG pairing; keeps one AI vendor relationship, not two |
| pgvector, not a dedicated vector DB | Everything stays inside the already-trusted RLS/multi-tenancy model |
| Knowledge retrieval built standalone, not wired into the Orchestrator yet | Avoids building the retrieval+generation combination twice |

Reversing one of these is fine — but it should be a deliberate call with a stated reason, not silent drift.

---

## 22. Communication Style

- Act like a senior engineer / technical co-founder — challenge weak ideas, propose alternatives, explain tradeoffs. Don't execute silently when something looks off.
- If the user's instruction conflicts with approved docs or an established pattern, say so before proceeding (§1) — don't guess, and don't refuse without explaining why.
- For ambiguous, expensive-to-reverse decisions (new schema shape, new vendor, anything touching tenant isolation or auth), check in before building. For reversible, well-justified calls, proceed and state the reasoning.
- Be concise. State results and decisions directly — don't narrate internal steps or pad responses with process commentary.
- Never commit without an explicit, current-turn ask — including after fixing something the user flagged.
- When a review surfaces an issue, report it plainly (what, why it matters, what you'd recommend) rather than silently fixing or silently ignoring it.

---

## 23. Session Bootstrap Checklist

1. Read `docs/07_Phase_Execution_Log.md` for current phase status — more current than §4.
2. `git log --oneline -5` and `git status` — confirm what's committed vs. pending; don't assume prior conversation state still matches disk.
3. `pnpm docker:up`, confirm Postgres (port **5433**) and Redis are healthy before assuming DB-dependent work will run.
4. `pnpm -r run typecheck` as a baseline sanity check before making changes.
5. If continuing knowledge/RAG work, confirm `VOYAGE_API_KEY` is set locally — ingestion/search fail gracefully but visibly without it.

## 24. Project Context Loading

Do not reread the entire documentation at the beginning of every task.

Choose the smallest amount of context needed.

Use these guidelines:

- For feature implementation:
  Read only the documents directly related to that feature plus the relevant source code.

- For architectural changes:
  Read the affected architecture documents before making changes.

- For bug fixes:
  Read only the relevant code and supporting documentation.

- Do not reread docs that have already been incorporated into the implementation unless you suspect they have changed or there is conflicting information.

- Trust previous architectural decisions recorded in CLAUDE.md and docs/07_Phase_Execution_Log.md.

If additional context becomes necessary while implementing, load it incrementally instead of reading every document first.

## 25. Documentation Reading Policy

Documentation is the source of truth, but it should be loaded on demand.

Avoid repeatedly reading all project documents in every session.

Read only:
- documents relevant to the current phase
- documents related to the feature being modified
- execution logs when continuing previous work

Only perform a full documentation review when explicitly requested by the user or before a major architectural redesign.