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
- `SupportOrchestrator` (`apps/api/src/orchestrator/support-orchestrator.ts`) — the literal System Architecture component, implemented as plain functions (`initiateConversation`, `handleCustomerMessage`) rather than a class, matching the rest of the codebase's style. This is the seat Phase 3 (AI calls, including wiring in Phase 2's Knowledge retrieval), Phase 4 (escalation), and Phase 5 (Integration actions) all extend rather than replace.
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

---

## Phase 2 — Knowledge & RAG

**Status:** ✅ Completed & Verified

### Key Deliverables Built

- Drizzle schemas + RLS for `knowledge_sources` and `knowledge_chunks`, following the same `withWorkspaceContext()` pattern as every prior table.
- A `vector` column type (`packages/db/src/schema/vector-type.ts`) via Drizzle's `customType` — this version of Drizzle has no first-class pgvector support — plus an HNSW index with `vector_cosine_ops` on `knowledge_chunks.embedding`.
- `EmbeddingProvider` interface (`apps/api/src/modules/knowledge/embedding-provider.ts`) with a `VoyageEmbeddingProvider` implementation (`voyage-3-lite`, 512 dimensions) — mirrors the PRS's "AI provider-independent" stance for the generation layer, applied to embeddings.
- A simple paragraph-aware chunker (target size + overlap, character-based, no tokenizer dependency).
- `knowledge.service.ts`: ingestion (`createKnowledgeSource`) and retrieval (`searchKnowledge`), both dashboard-facing (session-authenticated) — **not** wired into the live widget chat yet. That combination (retrieval + generation) is Phase 3's job.
- Dashboard Knowledge page: add a plain-text/FAQ source, see status update live via polling, run a search and see ranked results with similarity scores.

### Decisions Made During Implementation

- **Embedding provider: Voyage AI (`voyage-3-lite`, 512 dims)**, confirmed with the user before implementing — Anthropic has no embeddings API of its own and explicitly recommends Voyage for RAG use cases, keeping the AI stack aligned with the Claude-first strategy in `00_Product_Requirement_Specification.md` rather than adding an unrelated second vendor (e.g. OpenAI) for embeddings alone.
- **Ingestion scope: `plain_text` and `faq` only.** `pdf`, `docx`, `website` exist in the `knowledge_source_type` enum (per `04_Domain_Model.md`) so the schema won't need to change later, but the service rejects them for now (`UnsupportedSourceTypeError`) rather than pretending to support them. Matches the original Phase 2 scoping (start with text, defer file parsing and crawling).
- **Processing is in-process background work, not a blocking request or a real job queue.** `createKnowledgeSource` returns immediately after inserting the source row (`status: pending`); chunking + embedding happen in an un-awaited call, updating status to `processing` → `completed`/`failed`. The dashboard polls for status. Tradeoff: an API restart mid-processing leaves a source stuck in `processing` until manually retried — acceptable for small text sources today; a real queue with retries becomes worth the complexity once pdf/website ingestion makes this slower or higher-volume.
- **Retrieval is a standalone, dashboard-testable capability, not wired into the chat yet.** `SupportOrchestrator` was deliberately not touched this phase — combining retrieval with generation is Phase 3's responsibility, and wiring it in early would mean building it twice.
- **`EmbeddingProviderNotConfiguredError` is a proper `AppError` (503),** not a generic thrown `Error` — knowledge routes are dashboard/admin-only (not customer-facing), so surfacing "set VOYAGE_API_KEY" directly is more useful than collapsing it to a generic 500.

### Verified

- Real end-to-end run against the live Voyage API (once the user provided a key): created two topically distinct sources (Refund Policy, Shipping FAQ), both reached `completed`, and cross-queried each — "does express shipping cost extra?" ranked Shipping FAQ first (0.541 similarity) over Refund Policy (0.250); "can I get my money back?" ranked Refund Policy first (0.386) over Shipping FAQ (0.132). Confirms the embeddings are actually semantically discriminative, not just returning whatever exists.
- Tenant isolation re-confirmed on the new tables: Beta Co's `/knowledge/sources` and `/knowledge/search` both return empty against Acme's data.
- Dashboard Knowledge page browser-verified via Playwright: added a third source through the UI, watched it move from `pending` through the polling loop to `completed`, then searched and got the correct top result with its similarity score displayed. Zero console errors, zero failed requests.

### Pre-Commit Architecture Review

Before committing, a final review against long-term maintainability, scalability, security, tenant isolation, performance, extensibility, and Engineering Bible/System Architecture consistency surfaced three issues worth fixing immediately (project still small, all cheap to fix now):

1. **Missing `workspace_id` indexes.** A direct catalog check found `conversations`, `messages`, `customers`, `knowledge_sources`, `knowledge_chunks`, and `workspace_api_keys` had no index touching `workspace_id` at all beyond the primary key - every RLS policy and most app queries filter on it. Fixed by adding a plain `workspace_id` index to each, plus composite indexes matching the actual query shapes already in the code (`knowledge_sources`: `(workspace_id, created_at)`; `messages`: `(conversation_id, created_at)`). This was a pre-existing gap since Phase 0/1, not new to Phase 2, but Phase 2 added two more affected tables and was the natural point to close it everywhere in one pass.
2. **No role check on `/knowledge/*` mutation routes.** `workspace.routes.ts` established the pattern (API key management gated to `owner`/`administrator`); `knowledge.routes.ts` didn't follow it, meaning any authenticated role including `support_agent` could create/delete knowledge sources. Fixed by extracting the previously-duplicated inline guard into a shared `requireRole()` helper (`apps/api/src/modules/auth/require-role.ts`), used by both `workspace.routes.ts` (refactored) and the new `knowledge.routes.ts` guards on create/delete. Search stays open to all authenticated roles - it's read-only, and agents may want it to help customers. Verified directly: a temporary `support_agent` test account got a 403 on create, a 200 on search; the existing `owner` flow regression-checked clean.
3. **No batching against the embedding provider's request limits.** The dashboard's own `content` field allows up to 200,000 characters, which can chunk into ~250 texts sent in one Voyage API call - reachable today via a single long paste, not just a hypothetical future PDF. Fixed by splitting `embed()` into sequential sub-batches (`MAX_BATCH_SIZE = 100`) in `voyage-embedding-provider.ts`. Sequential rather than parallel batches deliberately, to avoid bursting concurrent requests (and cost) at the provider for one large document.

One issue was surfaced but deliberately left as a documented note rather than fixed: pgvector's HNSW index doesn't natively combine with a `WHERE workspace_id` filter the way a btree index would (Postgres applies the filter to the ANN candidate set, not the index scan itself) - at real scale, a workspace with few chunks could get fewer than `limit` results if other workspaces' chunks dominate the nearest-neighbor candidates. Not an issue at today's per-workspace chunk counts; noted in `knowledge-chunks.ts` for whoever revisits it once that's a real concern.

All fixes re-verified end-to-end after the changes (migration applied, role guard tested against both an allowed and blocked role, batching confirmed not to break normal small-document processing) before being considered ready to commit.

---

## Phase 3 — AI Service

**Status:** ✅ Completed & Verified

### Key Deliverables Built

- `apps/api/src/modules/ai/` — the AI Service the System Architecture names, wired into the Support Orchestrator for the first time (Phase 2 deliberately left this combination undone). Structure:
  - `ai-provider.ts` — the `AiProvider` interface and every provider-neutral type (`GenerateReplyInput`, `AiReplyResult`, `Citation`, `AiUsage`).
  - `ai.config.ts` — named tuning constants (`CONFIDENCE_ESCALATION_THRESHOLD`, `MIN_RELEVANCE_SIMILARITY`, `MAX_HISTORY_MESSAGES`, `RETRIEVAL_LIMIT`, `MAX_OUTPUT_TOKENS`), since there's no per-workspace `AI Configuration` entity yet.
  - `prompts/support-reply.prompt.ts` + `prompts/fallback-messages.ts` — system/user prompt text and the structured-output schema live here, not inside a provider file.
  - `providers/anthropic-ai-provider.ts` and `providers/gemini-ai-provider.ts` — two working implementations of `AiProvider`, selected at startup by `AI_PROVIDER=anthropic|gemini` (`ai.service.ts`'s `createAiProvider()`). Nothing outside `ai.service.ts` imports either provider class directly, including the Orchestrator.
- `support-orchestrator.ts`: `handleCustomerMessage` now kicks off an un-awaited `generateAiReply()` after persisting the customer's message (same fire-and-forget shape as Phase 2's knowledge processing) — retrieval → generation → persist → broadcast, with a server-sent `typing:start`/`typing:stop` around it (reusing Phase 1's existing wire event, zero new protocol, zero widget code changes needed).
- `messages.metadata` (nullable jsonb) — the column Phase 1's decision log flagged as "cheap to add exactly when Phase 3 needs it." Populated only for `ai`-sender messages: `{ provider, model, promptVersion, confidence, citations, usage, finishReason }`.
- `conversations.escalateConversation()` — merges `{ escalation: { reason, detail, escalatedAt } }` into the existing `conversations.metadata` (jsonb `||`, not an overwrite) and sets `status = 'escalated'`, the enum value that's existed unused since Phase 1. `EscalationReason` is a closed union (`no_relevant_knowledge`, `low_confidence`, `ai_requested_escalation`, `ai_provider_error`) so a future Agent Console can distinguish these instead of parsing free text.

### Decisions Made During Implementation

- **Provider-agnostic by explicit instruction, not just interface hygiene.** The user asked specifically not to depend on a paid API during active development: `AI_PROVIDER` defaults to `gemini` (free tier), with `anthropic` fully implemented and selectable via one env var, not a stub. Adding a third provider is one new file under `providers/` plus one new `switch` case in `ai.service.ts` — nothing in the Orchestrator, prompts, or config changes.
- **Structured output via forced tool/function-calling, not prompted JSON-in-prose.** Both providers force a single tool call (`respond_to_customer`) so parsing is deterministic. The schema itself (field names, types, descriptions, required list) is one plain, provider-neutral JSON Schema object in `support-reply.prompt.ts` — Anthropic's SDK consumes it as `Tool.input_schema` and Gemini's as `FunctionDeclaration.parametersJsonSchema` with zero transformation, since `@google/genai` accepts standard JSON Schema directly. This is what makes "add a third provider with minimal changes" actually true rather than aspirational.
- **`AiReplyResult.provider` is set by each provider itself, not assumed by the caller.** Caught in testing: an early version had the Orchestrator hardcode `provider: "anthropic"` into message metadata regardless of which provider actually ran. Fixed by making `provider` part of the neutral result type — exactly the kind of leak the "no provider-specific code in the Orchestrator" instruction was meant to prevent, and a good example of why that constraint needed a code fix, not just an interface that looked clean.
- **Two independent, structural guarantees against answering from general knowledge** (the user's explicit fifth requirement), not just a prompt instruction: (1) knowledge chunks below `MIN_RELEVANCE_SIMILARITY` (0.25, informed by Phase 2's real measured scores) are filtered out before the AI ever sees them, and if *nothing* clears that floor, the provider is never called at all — a structural guarantee, not a hope that the model complies; (2) the system prompt separately instructs the model to refuse rather than guess even when it is called with weak-but-present context. Confidence/escalation sits on top as a third, independent layer.
- **A low-confidence or self-escalating reply is still shown to the customer, not suppressed.** Only two cases get a fully hardcoded fallback message instead of the model's own words: zero relevant chunks retrieved (never calls the model), and a provider-level failure (bad/missing key, network error, or the model not returning a usable function call at all). If the model *did* answer using only the provided context but flagged low confidence or requested escalation itself, its actual reply is honest and grounded — showing it is more useful than replacing it with a canned message, and the conversation still flips to `escalated` either way.
- **Gemini's model id is a floating alias (`gemini-flash-latest`), not a dated pin like Anthropic's.** A dated model tried during implementation (`gemini-2.5-flash`) was rejected outright ("no longer available to new users") despite still appearing in the models-list endpoint — new API keys and dated model snapshots don't mix reliably on this provider. Since Gemini is specifically the low-stakes, cost-free dev-iteration path here (not the reproducibility-sensitive one), a floating alias is the right tradeoff; the concrete resolved model still gets recorded per-message via `response.modelVersion`, so there's an audit trail regardless.
- **`PROMPT_VERSION` (`prompts/support-reply.prompt.ts`) travels through `AiReplyResult` into `messages.metadata` the same way `provider` does** — each provider reports it, not the Orchestrator, even though both providers currently import the identical prompt file. Bump it whenever the prompt wording or schema changes meaningfully; it's what lets a later quality comparison ("did replies get better after that wording change?") key off which prompt version actually produced each stored reply. Exact model name was already correctly captured before this request (verified against both SDKs' response types, not just assumed) — `promptVersion` was the genuinely missing field.

### Verified

- Real end-to-end run against the live Gemini free tier: grounded questions ("What is your refund policy?", "What time are you open?") returned correct, cited answers (confidence 1.0, correct source chunk cited) with `metadata.provider` correctly recorded as `"gemini"`.
- No-relevant-knowledge path: an off-topic question never reached the provider at all and produced the hardcoded fallback + `escalated` status with reason `no_relevant_knowledge`.
- AI-requested-escalation path: an account-specific, frustrated-customer message ("refund my order #48213 RIGHT NOW") produced an honest, grounded, empathetic reply *and* flipped the conversation to `escalated` with reason `ai_requested_escalation` — confirmed the model's own reply is preserved rather than replaced.
- Provider-failure path: reproduced twice — once via a genuinely invalid model id, once via Gemini occasionally not honoring forced function-calling for a given generation (confirmed non-deterministic by re-running the identical input, which then succeeded) — both times failed safely to the hardcoded fallback + `ai_provider_error` escalation, no crash, no hallucinated answer shown.
- Tenant isolation re-confirmed on the new code path specifically (not just the tables): a cross-workspace check that AI generation for one workspace only ever retrieves and cites that workspace's own knowledge chunks.
- Browser-verified via Playwright: asked a question through the actual widget UI, confirmed the AI's reply rendered correctly using Phase 1's pre-existing `.message-ai` styling and the typing indicator fired during generation — zero widget code changes required, confirming the wire-protocol reuse worked as designed. Zero console errors, zero failed requests.

## Phase 4 — Collaborate (Human Handoff & Agent Console)

**Status:** ✅ Completed & Verified

### Key Deliverables Built

- **Schema:** `conversations.assignedUserId` (nullable FK → `users.id`, `ON DELETE SET NULL`) plus two composite indexes (`workspace_id, status` and `workspace_id, assigned_user_id`); `messages.senderUserId` (same nullable/`SET NULL` pattern) so an agent-sent message records who sent it. New `conversation_notes` table — a separate table rather than a new `messages.sender_type` value, workspace-scoped, RLS-enabled, indexed on `(workspace_id)` and `(conversation_id, created_at)`.
- **AI Service extension:** `summarize()` added to the `AiProvider` interface and implemented by both `AnthropicAiProvider` and `GeminiAiProvider`; `prompts/summarize-conversation.prompt.ts` (`SUMMARIZE_PROMPT_VERSION = 1`) follows the same "prompt lives outside the provider file" pattern Phase 3 established. `ai.service.ts` exports `summarizeConversationHistory()`.
- **Support Orchestrator additions:** `claimConversation`, `changeConversationStatus`, `sendAgentMessage`, `addInternalNote` (never broadcasts), `suggestReplyForAgent` (returns a draft, never persists or broadcasts), `summarizeConversationForAgent`. `handleCustomerMessage` now returns `assignedUserId` from its transaction and only kicks off the fire-and-forget AI reply `if (!assignedUserId)` — this single gate is the entire "live takeover" mechanism.
- **Routes:** `modules/conversations/conversation.routes.ts` (session-cookie authenticated, no role restriction — handling conversations is core `support_agent` work per the Domain Model) exposes list/detail/claim/messages/notes/suggest-reply/summarize/status. `modules/realtime/agent-console-ws.routes.ts` authenticates the dashboard's WebSocket via the same session cookie the browser already sends automatically on the handshake — no ticket exchange needed (that pattern stays reserved for the widget, which has no cookie to rely on).
- **Dashboard UI:** `/conversations` (queue, Unassigned/Mine/All tabs, 5s poll) and `/conversations/[id]` (message history over a live WS connection, claim/reassign button, status dropdown, AI summary panel with regenerate, suggested-reply-into-draft, internal notes sidebar).

### Decisions Made During Implementation

- **Internal notes live in their own table, not a new `messages.sender_type`.** Presented as an explicit choice via `AskUserQuestion`; the separate-table option was selected. Reusing `messages` would require every current and future query/broadcast path to remember to filter notes out — one missed filter is a customer-facing information leak. A separate table makes that leakage structurally impossible: the widget-facing code never queries `conversation_notes` at all. Verified live (see below), not just by inspection.
- **Claim/reassign UX is a state-aware client-side affordance, backend stays permissive.** Per explicit user instruction. The detail page shows "Claim" when unassigned, nothing (+"Assigned to you") when it's already yours, and "Reassign to me" — gated by a `window.confirm()` — when it's someone else's. The backend does not enforce any of this; any session-authenticated agent can call `POST /claim` regardless of current assignment. Every claim/reassign posts an automatic `system`-sender audit message ("X claimed this conversation." / "Reassigned from X to Y.") through the existing message/broadcast infrastructure — both a permanent record and a live notification to anyone watching, with zero new event types.
- **Read-vs-write split follows existing precedent, not a new rule.** `GET /conversations` and `GET /conversations/:id` call the repository directly from the route (matching `workspace.routes.ts` / `knowledge.routes.ts`), since a single-module read isn't cross-module orchestration. Every state-changing or AI-invoking action goes through the Orchestrator.
- **`PATCH /conversations/:id/status` deliberately accepts a narrower enum (`open | resolved | closed`) than the full six-value lifecycle.** `assigned` only ever happens via `claimConversation`, `escalated` only via the AI's own escalation path (Phase 3) — this endpoint is for the explicit human actions of resolving, closing, or reopening, not for hand-setting every internal state.
- **Assignee/sender/author display names are resolved via direct SQL joins against `users`** (`conversationWithAssigneeColumns`, `listMessages`'s `leftJoin`, `listConversationNotes`'s `innerJoin`) rather than standing up a separate user-listing endpoint — no second use case yet to justify that abstraction.

### Bugs Found and Fixed During Verification

- **`apps/dashboard/lib/api.ts`'s `apiFetch` unconditionally set `Content-Type: application/json`, even on bodyless POSTs.** Fastify rejects an empty body sent with that content-type (`FST_ERR_CTP_EMPTY_JSON_BODY`), which surfaced as a 500 on Claim, Suggest, and Regenerate-summary — all three are bodyless POSTs, all three worked fine via `curl` (which doesn't set the header without `-d`) and only broke through the real browser UI. This is exactly the class of bug §17 exists to catch — typecheck and curl both looked clean. Fixed by only attaching `Content-Type` when `init.body` is present.
- **`error-handler.ts` collapsed every non-`AppError`/`ZodError` exception to a generic 500,** discarding a framework-level `FastifyError`'s own accurate status code (the empty-body case above is a legitimate 400, not a 500). Added a pass-through branch for any error carrying its own 4xx `statusCode` before falling through to the generic 500/log branch — a defense-in-depth fix independent of the client-side one above, since any caller sending a malformed request should get an honest 4xx.
- **The status `<select>` bound `value={conversation.status}` but only listed `open`/`resolved`/`closed` as `<option>`s.** When the real status was `assigned` (or would be `escalated`/`waiting_for_customer`), the browser silently fell back to displaying "Open" — the first option — misrepresenting an assigned conversation as unclaimed. Fixed by rendering a disabled `<option>` for the current status when it falls outside the three manually-settable values, so the dropdown always displays the true state while still only allowing the three real transitions.

### Found in Pre-Commit Review (post-verification, before first commit)

A second pass — re-reading the diff fresh, checked against architectural consistency, security, tenant isolation, scalability, DB design, WS correctness, API design, and edge cases — caught four more issues the runtime verification above didn't exercise:

- **The `error-handler.ts` FastifyError pass-through (added during the bug-fix pass above) was duck-typed too loosely.** It matched any thrown object with a numeric 4xx `statusCode`, not just genuine Fastify framework errors. Confirmed concretely exploitable, not just theoretical: `@google/genai`'s `ApiError` type carries exactly that shape, so a Gemini failure during `suggest-reply` or `summarize` (bad key, quota, rate limit) would propagate through this branch and leak the raw provider error message to the dashboard client — defeating the file's own stated purpose ("the only place that decides what's safe to expose"). Fixed by additionally requiring `error.code` to start with `FST_`, so only Fastify's own framework errors (documented as client-safe) pass through.
- **`summarizeConversationForAgent` sent the entire, unbounded message history to the AI provider**, unlike `generateAiReply`/`suggestReplyForAgent`, which both cap context with `MAX_HISTORY_MESSAGES`. Contradicted the established "don't send an unbounded batch to a paid external API" guardrail and was user-triggerable repeatedly via "Regenerate summary" on arbitrarily long threads. Fixed with the same `.slice(-MAX_HISTORY_MESSAGES)`.
- **`saveConversationSummary` silently dropped `promptVersion` and `usage`** even though `SummarizeResult` carries both and every provider populates them — a regression against the precedent Phase 3 deliberately set (provider/model/promptVersion recorded on every AI-generated artifact). Fixed by extending the repository function's parameter type to include both; the JSON-merge already spread the whole object, so no separate persistence-path change was needed.
- **Missing index for the "All" conversations tab's actual query shape.** `listConversations` with no filter still does `ORDER BY updated_at DESC`, but none of the three existing indexes (`workspace_id` alone, `+status`, `+assigned_user_id`) supports that sort — the exact class of gap CLAUDE.md §8 already calls out as previously missed "for two phases before a review caught it." Added `conversations_workspace_id_updated_at_idx` (migration `0007_lyrical_chimera.sql`).

Not flagged as issues (checked and confirmed pre-existing/consistent, not Phase-4 regressions): no WS reconnect/disconnect indicator on the agent console — the widget's Phase-1 `ChatConnection` has the identical gap, so Phase 4 mirrored existing precedent rather than introducing a new one; no pagination on `listConversations` — consistent with every other list endpoint in the codebase today.

### Verified

- Claim on an unassigned, escalated conversation: `POST /claim` → 204, `GET` detail shows `status: assigned`, correct `assignedUserName`, and the audit message appended to history.
- Live takeover confirmed against a running system, not just typechecked: after assignment, a resumed widget WebSocket connection sent a new customer message and received **no** AI reply within a 6-second window — `handleCustomerMessage`'s `assignedUserId` gate holds.
- Agent-sent message (`POST /messages`) broadcasts live: a customer-side WS listener connected *before* the agent's reply was sent received the `message:receive` event in real time.
- **Internal-notes leak-prevention, the most architecturally important check this phase:** with the same customer-side WS listener still connected, `POST /notes` produced zero WS events on the customer side, while `GET /conversations/:id` correctly returned the note in its `notes` array (with `authorName` resolved).
- Reassignment: a second agent claiming an already-assigned conversation correctly posted "Reassigned from X to Y." and updated `assignedUserName`.
- `POST /suggest-reply` returns a draft (`reply`, `confidence`, `citations`, `provider`, `model`, `promptVersion`, `usage`) without persisting or broadcasting a message — message count unchanged before/after the call.
- `POST /summarize` persists into `conversations.metadata.aiSummary` (`text`, `provider`, `model`, `generatedAt`, and now `promptVersion`/`usage`) and is reflected on the next `GET`.
- `PATCH /status` transitions verified (`resolved`), rejected outside its narrow enum by Zod as designed.
- Post-review fixes re-verified live: `POST /summarize` response and persisted `metadata.aiSummary` both now include `promptVersion`/`usage`; the empty-body-with-JSON-header case (the original bug) still correctly returns 400 through the tightened `FST_`-scoped error-handler branch; an unrelated Zod validation error (`PATCH /status` with an invalid value) still returns its normal 400 unaffected by that change. Migration `0007_lyrical_chimera.sql` (the new `(workspace_id, updated_at)` index) generated, inspected, and applied.
- Tenant isolation cross-check: a Beta Co session got 404 (not 403 — doesn't reveal existence) on both `GET` and `POST /claim` against Acme's conversation, and Beta Co's own `GET /conversations` list contained only Beta Co's own data.
- Browser-verified via Playwright end-to-end, including re-verification after the three bug fixes above: queue page tab filtering, detail page claim/reassign (including the `confirm()` dialog and live audit-message arrival over WS with no page reload), Suggest populating the reply draft, Regenerate-summary updating the summary panel, and the status dropdown now accurately reflecting `assigned`. Zero console errors, zero failed requests on the final pass.
