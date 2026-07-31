# 07_Phase_Execution_Log.md

# Phase Execution Log

**Purpose:** Track what was actually built, verified, and decided in each implementation phase — a running record of execution, not a design document. The other docs (00-06) remain the source of truth for architecture and requirements; this log records how and when that architecture was realized, and any decisions made during implementation that future phases need to know about.

---

## Phase 0 — Foundation

**Status:** ✅ Completed & Verified

### Key Deliverables Built

- Monorepo structure: pnpm workspaces across `apps/api` (Fastify), `apps/dashboard` (Next.js), `apps/widget` (Preact, compiled to a standalone Shadow-DOM-mounted IIFE bundle), `packages/db` (Drizzle), `packages/shared` (shared types).
- Drizzle ORM schemas for `workspaces`, `users`, `workspace_api_keys`, matching the Domain Model exactly (a User belongs to one Workspace).
- Dockerized local infrastructure: PostgreSQL with pgvector, Redis.
- Authentication: JWT session cookies for the dashboard, SHA-256-hashed API keys for the widget — both implemented as the System Architecture's "Workspace Identification" step.
- Widget embedding proven via a real `<script>` tag on a simulated third-party host page, mounting into a Shadow DOM root for CSS/JS isolation.

### Architectural Security Highlights

- **Dual-layer multi-tenancy.** An application-layer `withWorkspaceContext()` transaction wrapper is the only path to any tenant-owned table (no repository function accepts the raw, unscoped `db` client). PostgreSQL Row Level Security backs this as defense-in-depth, enforced against a dedicated non-superuser `app_user` role (migrations run as `postgres`, which owns the tables, so RLS applies to `app_user` without needing `FORCE ROW LEVEL SECURITY`).
- **Hyper-constrained `auth_resolver` role.** Resolving a public identifier (a widget API key, or a workspace slug at login) into a `workspace_id` has to happen *before* a request has tenant context — RLS can't cover that by construction. Rather than let the whole app bypass RLS, a single `auth_resolver` Postgres role exists for exactly this: `BYPASSRLS`, but granted `SELECT` on only 3-4 specific columns across two tables (`workspaces`, `workspace_api_keys`). The blast radius of the bypass is small and auditable.

### Infrastructure Notes

- **Port 5433, not 5432.** The dev machine already runs a native Postgres service bound to 5432; the Dockerized Postgres for this project is mapped to host port 5433 to avoid silently talking to the wrong database. All local connection strings (`.env`) reflect this.
- **Fastify plugin registration must not be awaited individually.** `fastify.register()` returns a thenable, and `await`-ing each call individually triggers an implicit `ready()`/boot at that point, which silently locks in whatever's registered so far and skips everything registered afterward (including `setErrorHandler`). `apps/api/src/app.ts` registers all plugins/routes synchronously (no `await`) and lets the real boot happen once, when `server.ts` calls `app.listen()`.
- **CORS is single-registration with a per-request delegate**, not two separate `@fastify/cors` registrations — the plugin installs one global wildcard `OPTIONS` route for preflight handling, which collides if registered twice on the same Fastify instance. `corsOptionsFor(request)` in `app.ts` branches on path prefix (`/widget/*` = open CORS, no credentials; everything else = locked to `DASHBOARD_ORIGIN`, credentials on).

---

## Phase 1 — Conversation & Messaging Infrastructure

**Status:** ✅ Completed & Verified

### Key Deliverables Built

- Drizzle schemas + RLS for `customers`, `conversations`, `messages`, wired through the same `withWorkspaceContext()` pattern as every Phase 0 table.
- `SupportOrchestrator` (`apps/api/src/orchestrator/support-orchestrator.ts`) — the literal System Architecture component, implemented as plain functions (`initiateConversation`, `handleCustomerMessage`) rather than a class, matching the rest of the codebase's style. This is the seat Phase 2 (Knowledge retrieval), Phase 3 (AI calls), Phase 4 (escalation), and Phase 5 (Integration actions) all extend rather than replace.
- Real-time transport: `@fastify/websocket` at `GET /widget/ws`, fronted by a ticket-exchange handshake (`POST /widget/session`) to work around browsers not allowing custom headers on a WS upgrade.
- In-process conversation hub (`Map<conversationId, Set<WebSocket>>`) for message/typing fan-out — deliberately not Redis-backed yet (see below).
- Widget chat UI (Preact): bubble → panel toggle, message history, live send/receive, ephemeral typing indicator, all inside the existing Shadow DOM mount.

### Decisions Made During Implementation

- **Conversation status enum:** used the full lifecycle from `04_Domain_Model.md` (`open, waiting_for_customer, escalated, assigned, resolved, closed`) instead of the shorthand 3-value version floated at kickoff, to avoid a guaranteed rename when Phase 4 needs the finer-grained states. Confirmed with the user before implementing.
- **Added a minimal `customers` table** (`id`, `workspace_id`, `created_at` only) that wasn't in the original Phase 1 schema list but is required by `conversations.customer_id` per the Domain Model. Customers are anonymous in Phase 1 — no name/email/tags until a pre-chat form or CRM integration exists. Identity is a client-generated id the widget persists to `localStorage` on the *host page's* origin, which is what makes multi-tab sync within one customer's browser work for free.
- **WebSocket auth via short-lived ticket, not a raw API key in the URL.** `POST /widget/session` (authenticated via the existing `requireApiKey`) issues a 60-second single-purpose JWT; the widget opens `GET /widget/ws?ticket=...` with that instead of the long-lived key, avoiding a durable credential in a URL that proxies/browser history/logs would otherwise capture.
- **`conversation:initiate` treats a resumed `conversationId` as authoritative** over any separately supplied `customerId` — if the conversation resolves, its own `customerId` wins; a stale/invalid `conversationId` falls back to resolving-or-creating the customer and starting fresh. Never trusts client-supplied ids without a workspace-scoped DB lookup first.
- **No AI or canned auto-replies.** This phase is transport and persistence only; `message:receive` only fires for real, authored messages (customer messages today, agent/AI in later phases).
- **Real-time fan-out is in-process, not Redis-backed**, on the same reasoning as Phase 0's Redis notes — one API instance, no infra to run more yet. `publishToConversation`/`subscribe`/`unsubscribe` in `conversation-hub.ts` are the only surface callers use, so swapping in Redis pub/sub later shouldn't require changes outside that file.
- **Deferred, not built:** `attachments`/`ai_metadata` on messages, `sender_user_id` for agent messages. Nullable columns, cheap to add exactly when Phase 3 (AI) or Phase 4 (Agent Console) needs them.

### Verified

- CLI WebSocket smoke test: ticket issuance → connect → `conversation:initiate` → `message:send` → `message:receive` round trip, confirmed against the real API and database.
- Browser verification via Playwright: two tabs on the same simulated host-page origin, sharing `localStorage`, both connect to the *same* conversation; a message sent from either tab appears live in both; typing in one tab shows the indicator in the other. Zero console errors, zero failed requests.
