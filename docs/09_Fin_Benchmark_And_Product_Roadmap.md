# 09_Fin_Benchmark_And_Product_Roadmap.md

# Fin/Intercom Benchmark & CSA Product Roadmap

**Version:** 1.0
**Status:** ✅ Decided (source of truth for future product direction)
**Date:** 2026-08-26

**Purpose:** `docs/00`-`02` define what CSA is and why. `docs/07` is a chronological build log. `docs/08` tracks production-infrastructure status. None of them answer "given a mature reference product, what should CSA build next, and why not sooner?" This document is that answer — a durable reference for future sessions, so a roadmap decision made here isn't silently re-litigated or a deliberately-deferred item isn't accidentally rebuilt from scratch.

**How to use this document:** Section 1 is a benchmark, not a specification — CSA does not owe Intercom Fin feature parity. Section 4 is the load-bearing part: before proposing work that looks Fin-shaped, check whether it's already classified here, and follow that classification unless real customer evidence has changed since.

**Provenance note:** Section 1 reconstructs findings from an earlier working-session discussion of Intercom Fin, combined with generally known, publicly documented Fin/Intercom product behavior. It is a product-principle reference, not a technical audit of Intercom's actual implementation — several mechanism-level details (exact JWT claim structures, internal enforcement of workspace isolation, etc.) are not independently verifiable and are described at the level of observable product behavior only.

---

## 1. Fin/Intercom Benchmark

Treated throughout as **inspiration, not a spec** — a mature reference point for what a well-run AI support agent product eventually needs, not a checklist CSA must match.

| # | Capability observed | What Fin does |
|---|---|---|
| 1 | Messenger install & workspace identification | Copy-paste embed snippet; a public, non-secret `app_id` identifies the workspace client-side |
| 2 | JWT-based authenticated users | For logged-in products, the business's own backend cryptographically verifies a logged-in user's identity (a JWT/HMAC-based mechanism, per Intercom's public documentation) so Messenger treats them as a real, identified account holder rather than an anonymous visitor |
| 3 | Anonymous vs. authenticated context | Supports both — an anonymous visitor gets generic support; a verified user gets responses that can reference their real account/plan/data |
| 4 | Knowledge sources + Content Guidance | Multiple source types (help center, macros, snippets, files); explicit "Content Guidance" lets a business pin/prioritize which source wins when two sources conflict, and scope content to specific contexts |
| 5 | Safe behavior on insufficient knowledge | Declines rather than fabricates; defers to escalation |
| 6 | Escalation Rules / Guidance / Workflows | Business-configurable triggers (e.g., "always route billing disputes to a human"), plus structured multi-step guided answer flows |
| 7 | Human handoff | On escalation, the receiving agent gets an AI-written summary plus full conversation/customer context, with routing to the right team/queue |
| 8 | Data Connectors | Configurable external-API actions (Custom Actions/Workflows) a business wires up per workspace — read, and in some flows, write |
| 9 | Customer-specific backend data | Pulls a specific verified customer's own records (orders, plan, tickets) via connectors, authorized against their verified identity |
| 10 | Page/site context | Contextual awareness of what page the visitor is on, in some deployments |
| 11 | Pre-deployment testing | A business can test-drive the agent, including bulk/CSV question sets, before it goes live |
| 12 | Response review / evaluation | Systematic review of agent answers over time (an internal evaluation pipeline, at Intercom's own scale) |
| 13 | Analytics | Resolution rate, deflection rate, escalation-reason breakdown, CSAT, and content-level performance (which articles actually resolve vs. get escalated past) |
| 14 | Tenant/workspace isolation | Workspace-per-customer separation (Intercom's internal enforcement mechanism is not public; only the outcome is comparable) |
| 15 | Overall architecture pattern | A closed loop: knowledge → context → policy/guidance → tools → escalation → human → evaluation feeding back into knowledge/guidance |

### Product principles worth extracting (independent of Intercom's specific implementation)

- **Fin is a benchmark, not a backlog.** Its mature breadth reflects years of accumulated customer demand across thousands of workspaces — CSA should not build a capability simply because Fin has it. Timing and scope stay evidence-driven, per Section 3/4 below.
- Grounding + safe refusal is table stakes, not a differentiator — but it should be *structural*, not just prompted.
- Escalation should be **business-configurable**, not just AI-judgment-driven, especially where certain topics are sensitive/regulated.
- A human taking over a conversation needs the full story handed to them, not just the transcript — summary, reason, and relevant context, assembled automatically.
- Controlled external actions should generalize behind a clean interface, but the actual breadth of connectors should track proven demand, not be built ahead of it.
- Verified customer identity unlocks real personalization but is a meaningfully bigger commitment (auth model, per-business signing, authorization boundary) than anonymous support — it's a deliberate expansion, not a default.
- Evaluation and content-performance measurement close the loop — without them, knowledge and prompt quality can only improve by guesswork.
- Tenant isolation is foundational infrastructure, not a feature — it has to be right before anything else matters.

---

## 2. CSA Current State

Assessed directly against the codebase and `docs/07`'s verified build history, not assumed from the product docs.

| # | Capability | Classification | Basis |
|---|---|---|---|
| 1 | Install / workspace ID | **Already equivalent** | Widget key model reaches the same outcome (public, embeddable, non-secret identifier) after the widget-key security remediation milestone; adds origin allowlisting + rotation on top |
| 2 | JWT-authenticated users | **Missing** | No verified-identity mechanism. The existing JWT (60s WS ticket) is transport auth, not an identity assertion |
| 3 | Anonymous vs. authenticated context | **Intentionally different** — anonymous-only | Confirmed as a deliberate, repeated decision since Phase 1 ("Customers are anonymous... no name/email/tags until a pre-chat form or CRM integration exists"), most recently reconfirmed in Stage 1's security review ("the customer channel is anonymous by design") |
| 4 | Knowledge + Content Guidance | **Partially implemented** | Multiple source types + similarity-ranked retrieval exist; no explicit source-priority/conflict-resolution mechanism |
| 5 | Safe behavior on insufficient knowledge | **Already equivalent, arguably stronger** | Structural: zero chunks above `MIN_RELEVANCE_SIMILARITY` means the model is never called at all, not just instructed to decline. Confidence-threshold escalation is a second, independent layer |
| 6 | Escalation Rules/Guidance | **Partially implemented** | Deterministic phrase-detection + global confidence threshold + zero-grounding fast path all work and are well-tested; none are workspace-configurable |
| 7 | Human handoff (summary + context + routing) | **Partially implemented** | Context bundle is rich (AI summary, full escalation history, internal notes, captured contact); summary is on-demand ("regenerate"), not auto-fired on escalation; no team/queue routing exists — one flat per-workspace queue |
| 8 | Data Connectors | **Intentionally different** — narrow by design | One provider (HubSpot), one read-only action (`lookupContact`), heavily guarded AI-triggered path (Stage 1) |
| 9 | Customer-specific backend data | **Missing** — direct consequence of #2/#3 | `lookupContact`'s AI-triggered path is deliberately membership-only (`found: boolean` only) specifically because there is no verified requester to authorize a fuller record against |
| 10 | Page/site context | **Already equivalent** | Shipped (Chat Widget Redesign Phase 5) — URL + title, captured fresh per message, informational-only in the prompt |
| 11 | Pre-deployment testing | **Missing** | No test-question/CSV tool; verification has been manual (dev-session curl/Playwright), not a customer-facing feature |
| 12 | Response review / evaluation | **Missing** | `ai-evaluation` Operator exists but is explicitly RESERVED — no dataset/harness built |
| 13 | Analytics | **Partially implemented** | Resolution rate, escalation rate + reason breakdown, CSAT, AI token/provider stats, top-cited sources all exist; no explicit deflection-rate framing, no citation-vs-outcome (content effectiveness) signal |
| 14 | Tenant isolation | **Already equivalent or stronger** | Dual RLS + application-layer scoping, with a generic per-table isolation test suite — unusually rigorous for this stage |
| 15 | Overall closed loop | **Partially implemented** | Knowledge, context, tools, escalation, and human handoff all exist individually; the loop isn't closed at "configurable policy" or "evaluation feeds back into knowledge/guidance" |

### Genuine gaps vs. deliberate design choices

**Deliberate, already-reasoned choices — not gaps:**
- Anonymous-only customer identity (#3) — a repeated, explicit decision, not an oversight.
- Narrow Data Connectors (#8) — a generic connector framework has been explicitly rejected twice already (once before HubSpot existed, once before Stage 2) on "don't design against zero real cases" grounds.
- Flat queue, no routing (#7, partial) — there is no multi-team/skill domain model to route against; building one speculatively has no target to serve yet.

**Genuine gaps — real capability absence, not a considered tradeoff:**
- No workspace-configurable escalation rules (#6).
- No pre-deployment testing surface (#11).
- No evaluation harness (#12) — though the data it would need (`provider`/`promptVersion`/`confidence`/`citations` per message) is already captured, so this is an activation gap, not a re-instrumentation one.
- No content-performance/citation-outcome analytics (#13, partial).
- No auto-fired handoff summary at the moment of escalation (#7, partial).

---

## 3. Approved Product Direction

**Governing philosophy for every tier below:** evidence-driven expansion over speculative frameworks; keep CSA's controlled, auditable, narrow-interface approach; don't reproduce Intercom's maturity ahead of CSA's actual usage; don't invent vendors, integrations, workflows, or version commitments not already decided.

### V1 — frozen, nothing added

Nothing in this benchmark rises to a V1 completeness gap. The prior V1 audit's conclusion stands: V1 is complete (Billing & Subscription Management moved to V2 per `docs/00` §15/§16 and `docs/07`'s "V1 Completion Audit" milestone). Everything identified in Section 2 is enhancement, not core-completeness — do not reopen stable architecture, and do not add a Fin-shaped feature to V1 solely because Fin has it.

### V1.x — cheap, derivable from what already exists, gated on real usage starting to flow

- **Deflection-rate metric** — a pure query over data already captured by `analytics.repository.ts`; no new instrumentation.
- **Pre-deployment test-question tool** — a UI surface over the existing `searchKnowledge`/`generateSupportReply` pipeline (Phase 2/3), letting an owner ask real questions against the live knowledge base and see the AI's actual answer/confidence/citations before going live. No new AI capability required.
- **Auto-fire the escalation summary at the moment of escalation**, instead of leaving it purely on-demand ("regenerate").
- **Start collecting real transcripts toward an eval seed set** — a process to begin now, not a build; a meaningful eval set can't be constructed without real question distribution.
- **Enable Stage 1 (`aiToolCallingEnabled`) for one real design partner** and watch the already-built go/no-go instrumentation (`getEscalationReasonBreakdown` + `messages.metadata.toolAttempted/toolOutcome`) — this is the actual blocker on Stage 2, not vendor selection.
- **Wire `SENTRY_DSN` for real** and observe it against genuine traffic (carried over from `docs/08`).

### V2 — deliberate builds, justified by this benchmark *and* real V1.x signal

- **Per-workspace configurable escalation rules** (sensitive-topic triggers). A high-priority V2 candidate and the clearest safety-related gap identified in this benchmark: CSA's global, hardcoded confidence threshold gives a business no way to guarantee certain topics always reach a human, which matters more to the extent CSA serves sensitive or regulated use cases. Where this actually falls in V2 sequencing relative to the other items below should still be set by V1 usage, customer evidence, and priorities at the time, not fixed here.
- **Eval/regression harness** — activates the already-RESERVED `ai-evaluation` Operator, once real transcript volume exists to seed it.
- **Content/knowledge performance analytics** (citation-vs-outcome correlation: which sources are cited on conversations that still escalated or scored poorly on CSAT).
- **Source-priority/conflict guidance** — only if real, observed knowledge conflicts actually surface in a workspace; not built speculatively ahead of that evidence.
- **Verified customer identity (JWT-based) + customer-specific backend data** — explicitly gated on a real design partner needing the widget embedded inside their own logged-in product; not built ahead of that need. This is the single largest capability gap against Fin and also the one with the least current evidence of demand.
- **Stage 2 integration** — contingent entirely on real Stage 1 traffic and its go/no-go signal, per `docs/07`'s existing Stage 2 Readiness Assessment. No vendor or implementation is decided here; this section only confirms Stage 2 belongs in the V2 tier once unblocked.

### V3+ — only with real scale or demonstrated product demand

- **Team/skill-based conversation routing** — requires a multi-team domain model that does not currently exist; build only once a partner actually operates more than one support team/queue.
- **Broader connector library** beyond one-at-a-time, evidence-driven additions.
- **Guided, multi-step answer workflows** (Fin's "Workflows" analog).
- **Redis pub/sub + BullMQ-backed job queue**, multi-instance API scaling — already decided technology (`docs/08` §2), timing still correctly gated on a second API instance actually being needed.

### Stage 2 relationship (preserved, not re-decided)

Stage 2 (a second, read-only integration provider) remains exactly where `docs/07`'s Stage 2 Readiness Assessment left it: **GO WITH A DEFERRED DECISION.** The interface layer it needs already exists as a byproduct of Stage 1; there is no vendor-neutral scaffolding left to build ahead of evidence. Whether Stage 2 happens at all, and which vendor/vertical it targets, remain contingent on real Stage 1 usage data — nothing in this document changes that gate or proposes a vendor.

### Beyond the roadmap tiers — long-term platform direction (not a roadmap commitment)

CSA is the first specialized agent role built on the underlying BuildIQ AI-agent platform: Customer Service. The architecture patterns established here — a provider-neutral AI Service, the Support Orchestrator as sole coordinator, workspace/RLS tenant isolation, controlled provider interfaces — are platform-level, not CSA-specific, which is what makes this direction possible without a rewrite.

Over time, the same underlying agent infrastructure may support additional specialized roles — for example Sales, Ecommerce, Onboarding, or other domain-specific agents. **This is a strategic expansion direction, not a committed roadmap item:** none of V1/V1.x/V2/V3+ above include building a second agent role, and this note does not add one. Each such role, if and when pursued, should be introduced only when supported by validated customer demand, and should reuse the shared BuildIQ agent infrastructure (Orchestrator pattern, provider interfaces, tenant isolation model) rather than standing up an independent AI architecture per role.

This exists to record the strategic direction, not to schedule it — nothing about CSA's current V1/V1.x/V2/V3+ roadmap, architecture, or deployment status changes as a result.

---

## 4. Decision Rationale

For every meaningful difference from the Fin benchmark, the classification future sessions should treat as settled unless real customer evidence changes:

| Difference from Fin | Classification | Why |
|---|---|---|
| Widget install/workspace ID model | **Already sufficient** | Reaches the same outcome (public, safe, embeddable identifier) via a different but equally sound path; no further work needed |
| No JWT-verified customer identity | **V2 candidate, gated on demand** | Real product value (personalization, account-specific answers) but meaningfully bigger scope (auth model, per-business signing, authorization boundary); build only when a partner's actual embedded-in-authenticated-app need appears |
| Anonymous-only customer model | **Intentionally narrower for now** | A repeated, explicit product decision since Phase 1, not an oversight; revisit only alongside the JWT-identity item above, together, since they're the same underlying capability |
| No Content Guidance / source-priority | **V2 candidate, gated on evidence** | No observed knowledge conflicts yet in any real workspace; building conflict-resolution machinery ahead of a real conflict would be speculative |
| Structural safe-refusal on weak grounding | **Already sufficient — arguably stronger than the benchmark** | Model is never invoked below the relevance floor, not merely instructed to decline; do not weaken this to "just prompted" |
| No configurable escalation rules | **V2 candidate — high priority, clearest safety-related gap** | Global-only threshold gives no business-level guarantee that sensitive topics always reach a human, which matters more to the extent CSA serves sensitive/regulated use cases; still subject to V2 sequencing against V1 usage and evidence, not a fixed first-in-line commitment |
| Handoff summary is on-demand, not auto-fired | **V1.x improvement** | Small, low-risk change reusing an existing capability (`summarizeConversationForAgent`); no new architecture |
| No team/skill routing | **Later-scale (V3+)** | No multi-team domain model exists to route against; premature without a partner operating more than one team |
| Narrow Data Connectors (one provider, one action) | **Intentionally narrower, correctly so** | A generic connector framework has been explicitly rejected twice already on evidence-first grounds; do not reopen without a concrete second vendor need backed by real data |
| No customer-specific backend data access | **V2 candidate, gated on demand** | Direct consequence of the anonymous-identity decision above; same gating applies |
| Page/site context | **Already sufficient** | Shipped and verified (Phase 5); no further work indicated |
| No pre-deployment test-question tool | **V1.x improvement** | Cheap (reuses existing retrieval/generation pipeline), high confidence-building value, no new AI capability |
| No evaluation harness | **V2 candidate, gated on transcript volume** | Already correctly deferred via the RESERVED `ai-evaluation` Operator; the instrumentation it needs is already captured per-message, so this is an activation decision, not a re-architecture |
| No deflection-rate metric | **V1.x improvement** | Pure query over already-captured data |
| No content-performance (citation-vs-outcome) analytics | **V2 candidate, gated on usage** | Needs enough real conversation volume with mixed outcomes to be meaningful; premature on today's traffic |
| Tenant isolation model (RLS + app-layer) | **Already sufficient — a strength, not a gap** | Unusually rigorous for this stage; do not weaken or simplify without a specific measured reason |
| Stage 2 vendor/integration | **Deferred — decision preserved, not reopened here** | Contingent on real Stage 1 traffic per the existing Stage 2 Readiness Assessment; this document does not select a vendor or propose an implementation |
| Redis pub/sub + BullMQ, multi-instance scaling | **Later-scale (V3+), decision preserved** | Technology already decided (`docs/08` §2); timing remains gated on a second API instance actually being needed |
