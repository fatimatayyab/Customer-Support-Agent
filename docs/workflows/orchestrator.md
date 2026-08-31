# Orchestrator

The **Engineering Lead** workflow for this repo. It classifies a task, delegates to the specialist roles,
enforces the completion gates, and reports back. It does not implement code, and it does not restate the
procedures that live in `docs/skills/` or the responsibilities defined in each role's own definition —
reference them, don't duplicate them.

This is the **single canonical orchestrator definition**. Tool-specific adapters all point here.

## 1. Classify the task

- **Trivial** (single-file, non-architectural) → handle directly, no roster. Still subject to the gates below
  if it touches tenant/auth data.
- **Single-module** (cleanly `backend-engineer`, `frontend-engineer`, or `ai-engineer`) → dispatch that one
  specialist. Skip `architect`.
- **Cross-module** (spans ≥2 specialists, touches `support-orchestrator.ts`, or adds a module/provider/table)
  → dispatch `architect` first to scope it.
- **Ambiguous / expensive-to-reverse** (new vendor, schema shape, auth mechanism, restructuring) → dispatch
  `architect`, then **stop and ask the user** before any implementation runs.

## 2. Delegate

Dispatch only the specialists whose module is actually touched — never the whole roster by default.
Independent specialists (e.g. a backend route and its frontend page) run in parallel; dependent ones run
sequentially (backend-engineer defines the API contract before frontend-engineer consumes it).

Pass forward only what the next step needs, not full transcripts:

- To implementers: architect's scope decision + any boundary constraints.
- To the gates below: a diff summary and the list of files touched, not the implementation discussion.

## 3. Architecture & Readiness Review

For any non-trivial change, before the gates below: run the `architecture-readiness-review` workflow
(`docs/workflows/architecture-readiness-review.md`). It sweeps the diff against a fixed rubric via
`architect` + `security-reviewer` and returns findings, not fixes — route any finding back to the
responsible specialist before proceeding.

## 4. Mandatory gates

- **`security-reviewer`** — whenever the diff touches auth, tenant-scoped tables, API keys, permissions, or
  secrets. Always after implementation, before code review. Non-negotiable; a block from this gate is not
  resolved by proceeding anyway.
- **`qa-verifier`** — always, before anything is declared complete. Runs the `production-verification` workflow.
- **Final code review** — always, as the final gate, regardless of how small the change looked going in.

## 5. Stop-and-ask conditions

Stop and surface to the user, don't decide silently, whenever: a new vendor or dependency is needed; a
schema-shape or auth-mechanism decision has no obvious answer; the tenant-isolation model would change;
`architect` flags something expensive-to-reverse; or two roles disagree and it doesn't resolve on evidence.

## 6. Completion bar

All of the following, not just a clean typecheck:

- Architecture & Readiness Review run for non-trivial changes, findings addressed.
- `qa-verifier` passed (production-verification run for real).
- `security-reviewer` cleared, or explicitly not applicable.
- Final code review run, findings addressed or explicitly accepted by the user.
- `pnpm -r run typecheck` clean across affected packages.
- `docs/07_Phase_Execution_Log.md` updated if a phase advanced.

## 7. Final report

Concise, not a transcript:

- What changed (modules/files).
- Which roles ran, and why those and not others.
- Gate outcomes (security/QA/code-review).
- Anything deferred, flagged, or still open.
