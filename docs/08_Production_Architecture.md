# 08_Production_Architecture.md

# Production Architecture & Decisions

**Version:** 1.2
**Status:** ✅ Decided (source of truth for production direction)

**Purpose:** `03_System_Architecture.md` describes the conceptual, approved architecture — components and their responsibilities, not their build/deploy status. `07_Phase_Execution_Log.md` is a chronological record of what was built in each session. Neither answers "is this actually running, or just planned?" for a given production concern. This document is that answer — one place, organized by component, that six months from now still tells you exactly what's real, what's formally decided but not yet built, and what's genuinely still open. It does not restate `03`'s component responsibilities; it tracks their production status.

Nothing in this document authorizes a deployment or a code change by itself — it's a decision record. Each decision gets implemented in its own future phase, logged in `07` when it happens.

---

## Status legend

- **IMPLEMENTED** — real, working code in this repository today.
- **DECIDED FOR PRODUCTION** — not built yet (or only built for local dev), but the technology/approach/role to use in production is formally settled.
- **PLANNED** — direction agreed in principle, described in code comments or docs, but not yet locked as a specific production decision.
- **DEFERRED UNTIL NEEDED** — the *what* is decided; the *when* is deliberately postponed until a concrete trigger makes it necessary. Not indecision — a decision about timing.
- **NOT DECIDED** — genuinely open. No code, comment, or doc commits to an approach yet.

---

## 1. Component-by-component status

| # | Component | Status | Notes |
|---|---|---|---|
| 1 | API / modular monolith | **IMPLEMENTED**; direction **DECIDED FOR PRODUCTION** | Fastify/Node, Support Orchestrator as sole coordinator. Staying a modular monolith in production is a deliberate decision, not a placeholder — see §5. A Production Readiness Audit (2026-08-24) found the documented start command (`node dist/server.js`) actually crashed on boot — `@csa/db`/`@csa/shared` ship raw TypeScript with no build step, so plain Node couldn't resolve them. Fixed by running production the same way dev does (`tsx src/server.ts`, now the `start` script); verified by booting locally against the real production Supabase database end-to-end. Also added: graceful shutdown (`SIGTERM`/`SIGINT` → a clean `app.close()`, previously absent) and a deepened `/health` check that verifies live DB and Redis connectivity rather than just process liveness. |
| 2 | PostgreSQL + pgvector + RLS | **IMPLEMENTED** — locally (docker-compose) and now in production (Supabase) | Real schemas, real RLS, real tenant-isolation test suite. The production role/RLS bootstrap has been executed and independently verified against the real Supabase project: all 29 migrations applied cleanly, and a live query confirmed RLS enabled on all 20 tables, the three production roles (`app_user`/`auth_resolver`/`platform_operator`) exist with the correct `BYPASSRLS`/grant attributes, and `auth_resolver`/`platform_operator` hold only their intended narrow, column-level grants — see §3. The four DB connection pools (`client.ts`, `auth-resolver-client.ts`, `platform-operator-client.ts`, `migrate.ts`) now each set an explicit `max` size rather than relying on an implicit default. |
| 3 | Redis | **IMPLEMENTED** — live in production via **Upstash** (`rediss://`) | Backs `@fastify/rate-limit` today and is a hard runtime dependency. Managed hosting is now the live reality (Upstash), not a future plan — see §3. |
| 4 | Realtime / WebSockets | **IMPLEMENTED** (in-memory, single-instance) | See §2 — Redis pub/sub is the confirmed target, deferred until a second instance is needed. |
| 5 | Background jobs | **IMPLEMENTED** (in-process, single-instance) | See §2 — Redis-backed queue (BullMQ) is the confirmed target, deferred until job durability/scale is needed. |
| 6 | AI / embedding providers | **IMPLEMENTED** | Gemini + Anthropic behind `AiProvider`, Voyage for embeddings, all swappable via one env var. Which provider is the primary *production* default is a product/cost decision, not architectural — **NOT DECIDED**, and doesn't need to be for this document. Each provider call now sets an explicit 20s request timeout (`anthropic-ai-provider.ts`/`gemini-ai-provider.ts`) — previously unbounded, which could leave a customer-visible reply stuck indefinitely on a hung call. |
| 7 | Integrations & future webhooks | **IMPLEMENTED** (HubSpot, outbound actions only) | The extend-the-interface pattern for new integrations is already approved (`03`'s "extend, don't restructure"). No inbound webhook receiver exists; which integration needs one, and when, is **NOT DECIDED** — nothing in the product today requires one. Outbound HubSpot/Airtable calls now set an explicit 10s request timeout (previously unbounded). |
| 8 | Client Dashboard | **IMPLEMENTED** — live in production on **Vercel** (`https://csa-dashboard-livid.vercel.app`) | Next.js, session-cookie auth (`requireSession`), same-origin `/api` rewrite proxy to Render. Hosting vendor is now real (Vercel), superseding the earlier "vendor not decided" note — see §3. |
| 9 | Platform Owner Dashboard | **IMPLEMENTED** — as routes inside the *same* Next.js app as the Client Dashboard | `app/platform/**` vs `app/(workspace)/**` in `apps/dashboard` — two route trees, one deployable, already isolated by a separate session cookie/JWT secret (`PLATFORM_SESSION_JWT_SECRET`) and a separate DB role (`platform_operator`). This matters for §4 (domains) — there is no second frontend app to deploy today. |
| 10 | Chat widget | **IMPLEMENTED** — live in production from **Vercel** (`https://csa-widget.vercel.app/widget.js`) | Preact/Vite, Shadow-DOM-isolated, fully runtime-configured (`window.CSAWidgetConfig`) — no rebuild needed per deployment target. |
| 11 | API hosting | **IMPLEMENTED** — live in production on **Render** (`https://csa-api-ql1o.onrender.com`) | Persistent, container-based hosting (matches the required role in §3); Docker web service, `numInstances: 1`, health check `/health`, auto-deploy on `main`. Render is now the live host, not just a temporary widget-testing choice. |
| 12 | Widget static/CDN hosting | **IMPLEMENTED** — live on Vercel serving `apps/widget` | The "move `widget.js` off the API onto a real static host/CDN" direction is now realized (Vercel, `Access-Control-Allow-Origin: *`, sensible cache headers). No longer deferred. |
| 13 | CI/CD | **IMPLEMENTED** (minimal) | `.github/workflows/ci.yml` runs typecheck, lint, and all three real-DB test suites (`packages/db`, `apps/api`, `apps/widget`) on every push/PR, against Postgres and Redis service containers. Mirrors exactly the steps verified passing locally. Deploys are manually driven (Render auto-deploys API on `main`; Vercel from `.git`-stripped manual deploys) — no CI deploy step. |
| 14 | Dev / staging / production environments | **IMPLEMENTED** (production now live) | Dev exists (docker-compose + `.env`). No separate staging environment exists, but "production" is now real: API on Render, dashboards/widget on Vercel, Postgres on Supabase, Redis on Upstash. |
| 15 | Authentication, API keys, secrets | **IMPLEMENTED** (core primitives) | Argon2 passwords, SHA-256 API keys (shown once), encrypted integration credentials, invite-gated signup, two structurally separate session types (workspace vs platform). Argon2 now uses explicit OWASP-baseline parameters (19 MiB memory cost, up from the library's 4 MiB default). `/auth/login` now also rate-limits per workspace+email (5/10min), layered on top of the existing IP-keyed limit, to blunt distributed credential-stuffing against one account. Test coverage for the auth/session/API-key/WS-ticket paths — previously the largest untested surface in the repo — now exists (`require-session.test.ts`, `require-role.test.ts`, `require-api-key.test.ts`, `widget-ws-ticket.test.ts`, all real-DB). A dedicated secrets manager (vs. platform-provided env vars) is **NOT DECIDED** — current approach is adequate at this scale. MFA/SSO: **NOT DECIDED**, no product requirement yet. |
| 16 | Monitoring, logging, error tracking | **IMPLEMENTED** (baseline + optional error tracking) | Structured logging via Pino. `@sentry/node` is now wired into `error-handler.ts`'s catch-all branch, gated on an optional `SENTRY_DSN` — a no-op until one is configured, same pattern as `VOYAGE_API_KEY`; not yet exercised against a real Sentry project. No metrics/alerting stack — correctly out of scope at this stage. |
| 17 | Backups & database migrations | **IMPLEMENTED** (migrations) | `pnpm db:generate` → inspect → `pnpm db:migrate`, already the enforced workflow. Automated backups: **NOT DECIDED** as a standalone build item — in practice this is usually inherited from whichever managed Postgres vendor is chosen (§3), not something built separately; worth confirming explicitly once that vendor is picked, not before. |
| 18 | Custom domains | **NOT DECIDED** (no domain owned) | Architecture is already domain-agnostic (CORS/cookie origin is env-var driven, `DASHBOARD_ORIGIN`) — adopting a real domain is a config change, not a code change. See §4. |
| 19 | Scaling & load balancing | **DEFERRED UNTIL NEEDED** | Correctly out of scope until real traffic demands it — see §6, Stages 4-5. |
| 20 | Security hardening | **IMPLEMENTED** (core) / **NOT DECIDED** (advanced) | RLS, rate limiting, encrypted credentials, invite-gated signup are real. WAF/bot protection, dependency scanning, extended audit logging, pen testing: **NOT DECIDED**, not yet needed at current scale. |

---

## 2. The two confirmed future transitions

### Realtime: in-memory hub → Redis pub/sub

**Current:** `conversation-hub.ts` is an in-memory `Map<conversationId, Set<WebSocket>>` — correct and sufficient for exactly one API instance, and already documented in its own comments as the seam for this swap.

**Confirmed direction:** yes, `API instances → Redis pub/sub → realtime connections` is the right evolution — `SUBSCRIBE`/`PUBLISH` per `conversationId`, replacing the in-memory `Map`. Redis is already a live runtime dependency (rate limiting), so this doesn't introduce a new piece of infrastructure, only a new use of one already in production.

**Status:** target technology **DECIDED FOR PRODUCTION**. Build timing **DEFERRED UNTIL NEEDED** — the trigger is the first time the API needs to run as more than one instance (for throughput or zero-downtime deploys). Building it earlier buys nothing; the current code already isolates the swap to `conversation-hub.ts`'s three exported functions.

### Background jobs: InProcessJobRunner → Redis-backed queue

**Current:** `job-runner.ts`'s `InProcessJobRunner` fires detached work (`void task()`) after the HTTP response returns — correct as long as the process that started the task is the same process that finishes it, which is only guaranteed with one long-running instance and no forced restarts mid-task.

**Confirmed direction:** yes, `API → Redis-backed queue → worker(s)` is right, and **BullMQ is the appropriate technology** — it's the standard, well-maintained choice for Redis-backed job queues in Node, and Redis is already provisioned. Document this as the intended technology now; do not add the dependency or build it yet.

**Status:** target technology **DECIDED FOR PRODUCTION** (BullMQ on the existing Redis). Build timing **DEFERRED UNTIL NEEDED** — the trigger is whichever comes first: (a) a second API instance (making in-process fire-and-forget unsafe the same way it affects realtime), or (b) a real need for job durability/retries (e.g. an embedding job or Airtable sync surviving a deploy restart, which today it does not). `job-runner.ts`'s `JobRunner` interface already isolates this swap to one file and is already test-covered via `SynchronousJobRunner`.

---

## 3. Hosting roles (vendor-neutral)

Render was originally the *immediate, temporary* choice for `apps/api`; as of the "API deployed to Render"
milestone it is the live production host. Only the **role** each piece plays is a durable decision; the
vendor is recorded here as it currently stands. Live deployments supersede the earlier "vendor NOT DECIDED"
notes below where noted.

| Piece | Role | Vendor |
|---|---|---|
| `apps/api` | Persistent, container-based hosting — must support long-lived WebSocket connections and a process that keeps running past an HTTP response (required by §2 until the Redis-backed swaps land, and still true after) | **DECIDED IN PRACTICE: Render** (`https://csa-api-ql1o.onrender.com`, Docker web service, Singapore region near Supabase's `ap-southeast-2`). Chosen because it offers a persistent container (not request-scoped serverless/FaaS) — the genuine architectural constraint. |
| Client Dashboard (`apps/dashboard`) | Frontend hosting (static/edge-capable Next.js host) | **DECIDED IN PRACTICE: Vercel** (`https://csa-dashboard-livid.vercel.app`). |
| Platform Owner Dashboard | Same deployable as the Client Dashboard today (§1, item 9) — same frontend hosting role | **Vercel** (same deployable as the Client Dashboard, per §4 options). |
| PostgreSQL | Managed production PostgreSQL with pgvector support and the ability to create additional non-superuser roles (`app_user`, `auth_resolver`, `platform_operator`) with custom grants | **DECIDED: Supabase — bootstrap complete.** A 2026-08-24 Production Readiness Audit flagged granting `BYPASSRLS` to a non-superuser role as unverified and a potential go/no-go blocker on any managed Postgres vendor (per Postgres's own rule, only a superuser or an already-`BYPASSRLS` role can grant it). Verified directly against a real Supabase project's admin role: created, verified, and removed a test `BYPASSRLS` role successfully. The production bootstrap has since been executed and independently verified: the `vector` extension and all three roles exist on the real project, all 29 migrations applied cleanly, and a live query confirmed RLS coverage (20/20 tables) and that each role's grants match exactly what the codebase's own migrations define — no discrepancies found. |
| Redis | Managed Redis, reachable by the API at all times (already a hard dependency today, before pub/sub or a job queue add more reliance on it) | **DECIDED IN PRACTICE: Upstash** (`rediss://`), backing `@fastify/rate-limit` live. |
| `widget.js` | CDN/static hosting, decoupled from the API's own deploys | **DECIDED: Vercel** (`https://csa-widget.vercel.app/widget.js`), served with `Access-Control-Allow-Origin: *` and cache headers. |

---

## 4. Domain architecture

Proposed structure:

- `app.example.com` → Client Dashboard
- `platform.example.com` → Platform Owner Dashboard
- `api.example.com` → API
- `cdn.example.com` → widget assets

This is a sound target **once a domain is owned**, with one correction worth flagging now rather than after a deploy attempt: **the Client and Platform Owner Dashboards are the same Next.js deployable today** (§1, item 9) — there is no second app to point `platform.example.com` at. Two ways to realize the structure above without a code change:

1. Deploy the one dashboard build under **two hostnames** (`app.example.com` and `platform.example.com` both serving the identical build) — zero code changes, just two hosting entries pointing at the same artifact. Each audience only ever gets linked to the routes relevant to them.
2. Skip the subdomain split for the Platform Owner Dashboard and use a path instead (`app.example.com/platform`) — also zero code changes, one fewer thing to provision.

A *real* split into two separate deployable apps (for independent scaling, branding, or stricter network-level isolation) is a legitimate future step but is **NOT DECIDED** and not necessary for either option above.

**Cookie/auth implications:** this domain structure actually **resolves** the cross-origin cookie problem raised earlier when Client-Dashboard-testing-against-a-different-platform's-domain was discussed. `SameSite=Lax` (the API's current, unchanged setting — [session-token.ts](../apps/api/src/modules/auth/session-token.ts)) blocks a cookie only on requests that are cross-*site* — i.e., a different **registrable domain**. `app.example.com`, `platform.example.com`, and `api.example.com` are all subdomains of the same registrable domain (`example.com`), so they count as **same-site** despite being different origins. Once real subdomains like this are in place, the existing `sameSite: "lax"` cookie configuration works correctly for both dashboards talking to the API, **with no code change** — the earlier concern only applies to today's mismatched, platform-assigned domains (e.g. `localhost` vs. `*.onrender.com`), not to this target structure.

---

## 5. Is the current architecture direction sound?

**Yes — confirmed, no change in direction.** The modular monolith, Support Orchestrator-as-sole-coordinator, and multi-tenant RLS model are genuinely good fits for this product at this stage and well beyond it: the domain isn't naturally decomposed into independently-scaling services yet (one workspace's chat volume doesn't need to scale separately from its knowledge ingestion), the team is small, and `03_System_Architecture.md` already anticipated this — "services can be extracted into separate microservices without changing the overall architecture" as load eventually demands it, not before. No microservices, no Kubernetes, no architectural pivot is warranted by anything in the current code or roadmap.

**How it evolves into production without a rewrite:** every open item in §1 is an isolated, already-anticipated seam, not a structural conflict:

- Realtime and background jobs each have a single-file swap point already written with that swap in mind (§2).
- Hosting, domains, and CDN are pure deployment/config decisions — nothing in the app code assumes a specific host or domain (env-var-driven CORS/origin config already sees to that).
- CI/CD, monitoring, and backups are additive — they wrap the existing system, they don't change it.

The risk isn't the architecture; it's letting the deferred items (§2 especially) stay deferred past the point they're actually needed — i.e., adding a second API instance *before* Redis pub/sub and the job queue land, which would silently break realtime fan-out and duplicate/drop background jobs. §6's staging exists specifically to prevent that ordering mistake.

---

## 6. Scaling philosophy

Confirmed, with one clarification (widget CDN migration, marked below, is independent of instance count and can happen at any stage):

**Stage 1 — now.** Single API instance. Today's in-memory realtime hub and in-process job runner as-is. *(This is also where the immediate Render widget-testing deployment sits — Stage 1 infrastructure, not a jump ahead to Stage 2.)*

**Stage 2 — managed infrastructure.** Partially underway: managed Postgres (Supabase) is provisioned, migrated, and its schema/RLS/roles independently verified; CI/CD and baseline (optional) error tracking are implemented. Still needed: managed Redis, and a Dockerfile — no container image exists yet, and nothing has actually been deployed anywhere; the fixed production start command has only been boot-verified locally against the real Supabase database. Still a single API instance — none of this requires the realtime/job swaps yet. *(Widget CDN migration can happen here, or earlier — it isn't gated on anything else in this list.)*

**Stage 3 — Redis pub/sub + job queue.** Build the two swaps from §2 (Redis pub/sub for realtime, BullMQ-backed queue for jobs) — **before** adding a second instance, not after, since both are what make a second instance safe.

**Stage 4 — multiple API instances + load balancing.** Only viable once Stage 3 is done; this is the actual point of Stage 3.

**Stage 5 — further scaling only when real traffic requires it.** Correct as stated — no work here until a concrete, measured need exists (read replicas, connection pooling, multi-region, etc.).

This progression is confirmed as correct and requires no reordering.

---

## 7. What remains genuinely open

Everything marked **NOT DECIDED** in §1: final API/Redis/frontend hosting vendors (Postgres is now decided — Supabase, see §3), a custom domain, a secrets manager, MFA/SSO, and advanced security hardening beyond what's already implemented. CI/CD tooling and error tracking are no longer open — both are now implemented (§1, items 13 and 16). None of the remaining items block Stage 1 (the immediate Render deployment) — they're Stage 2+ decisions, to be made when each is actually being built, not speculatively now.
