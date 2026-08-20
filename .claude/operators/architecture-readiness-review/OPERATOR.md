# Architecture & Readiness Review

**Purpose:** Whole-diff or whole-repo consistency sweep against a fixed rubric — maintainability, scalability, extensibility, security, tenant isolation, performance, architecture-doc consistency — run before the mandatory completion gates.

**Status:** ACTIVE

**Trigger / activation:** Any non-trivial change, before `qa-verifier` and `/code-review` — the Orchestrator drops into this as one of its own steps. Also runs standalone, periodically or on demand, scoped to the whole repository.

**Agents coordinated:** `architect`, `security-reviewer`.

**Skills used:** `tenant-isolation-review`, plus whichever module skill the touched code maps to.

**Workflow:** the full executable procedure lives in `.claude/commands/architecture-readiness-review.md` (this is the one Operator wired up as a real slash command). Summary: read the diff or survey the repo → `architect` pass (maintainability/scalability/extensibility/performance/doc-consistency) → `security-reviewer` pass (tenant-isolation checklist) → merge into one prioritized findings list → route each finding back to the responsible implementer.

**Boundaries:** Produces findings, never fixes. Does not replace `security-reviewer`'s or `qa-verifier`'s own mandatory gates — those still run regardless of what this Operator finds. Does not restate `architect`'s or `security-reviewer`'s role definitions.
