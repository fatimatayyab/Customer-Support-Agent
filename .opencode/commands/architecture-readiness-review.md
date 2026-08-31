---
description: Architecture & Readiness Review Operator — whole-diff or whole-repo consistency sweep against a fixed rubric, run before the mandatory gates. Coordinates architect + security-reviewer; produces findings, not fixes.
agent: orchestrator
---

You are running the Architecture & Readiness Review Operator. Read `docs/workflows/architecture-readiness-review.md`
and `docs/operators/architecture-readiness-review/OPERATOR.md` and follow them exactly.

Scope: **$ARGUMENTS** (default: the current diff against `main`; pass "full" or "whole repo" for the periodic
whole-product mode).

Dispatch the `architect` subagent (maintainability/scalability/extensibility/performance/doc-consistency) and the
`security-reviewer` subagent (tenant-isolation checklist) and merge their findings into one prioritized list.
Return findings, not fixes — route each finding back to the responsible specialist. Do not replace the
mandatory `security-reviewer`/`qa-verifier` gates.
