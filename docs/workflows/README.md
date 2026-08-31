# Workflows (tool-neutral source of truth)

This directory holds the **canonical, tool-neutral** definitions of the fixed coordination workflows that
are not simple role calls.

- [`orchestrator.md`](orchestrator.md) — the engineering-lead workflow that classifies a task, routes it
  to the right roles, enforces the completion gates, and reports back. **This is the single canonical
  orchestrator definition.**
- [`architecture-readiness-review.md`](architecture-readiness-review.md) — the fixed-rubric, whole-diff /
  whole-repo consistency sweep, run before the mandatory completion gates.

Tool-specific hooks:

- `.claude/commands/orchestrator.md` and `.claude/commands/architecture-readiness-review.md` — Claude Code
  slash-command adapters (kept intact until parity is verified).
- `.opencode/agents/orchestrator.md` and `.opencode/commands/architecture-readiness-review.md` — OpenCode
  adapters.

If a workflow changes, change it **here** first.
