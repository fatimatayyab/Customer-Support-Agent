---
description: Architecture & Readiness Review Operator — whole-diff or whole-repo consistency sweep against a fixed rubric, run before the mandatory gates. Coordinates architect + security-reviewer; produces findings, not fixes.
---

# Architecture & Readiness Review

You are running the Architecture & Readiness Review Operator — a fixed-rubric sweep, not an arbitrary-task orchestrator. Scope: **$ARGUMENTS** (default: the current diff against `main`; pass "full" or "whole repo" to run the periodic whole-product mode instead).

## When this runs

- Before `qa-verifier` and `/code-review`, for any non-trivial change — the Orchestrator drops into this as one of its own steps.
- Standalone, periodically or on demand, scoped to the whole repository — the "what would actually break or embarrass us for a real customer" sweep this project has already done twice by hand (see `docs/07_Phase_Execution_Log.md`, Phase 2 and Phase 4, "Pre-Commit Architecture Review").

## What this does NOT do

Does not implement fixes. Does not replace the mandatory `security-reviewer`/`qa-verifier` gates — they still run regardless of this Operator's findings. Does not restate `architect`'s or `security-reviewer`'s own role definitions; it invokes them.

## Procedure

1. Read the diff (or, in whole-repo mode, survey `apps/*` and `packages/*` module by module).
2. Dispatch `architect` against: maintainability, scalability, extensibility, and consistency with `docs/00`–`06` and CLAUDE.md §2's module boundaries. Performance red flags (missing indexes, unbounded queries, chatty realtime traffic) are checked as part of this pass — the exact class of gap this sweep has caught before that per-feature review missed.
3. Dispatch `security-reviewer` against the `tenant-isolation-review` skill's checklist, applied to every table/route touched (or, in whole-repo mode, every workspace-owned table).
4. Merge both agents' findings into one prioritized list — don't let either agent's pass silently drop something the other would have caught differently.

## Output

A prioritized findings list, not fixes: what's wrong, which file/module, severity. Route each finding back to the responsible specialist (`backend-engineer` / `frontend-engineer` / `ai-engineer`) for remediation, then proceed to `qa-verifier` → `/code-review` as normal.
