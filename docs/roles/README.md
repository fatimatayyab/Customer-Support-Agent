# Roles (tool-neutral source of truth)

This directory holds the **canonical, tool-neutral** definition of every specialist
role in this project. Each file describes who the role is, what they own, their
boundaries, when they apply, and what they must produce — without any reference to a
specific coding tool.

Tool-specific layers are thin adapters:

- `.claude/agents/*.md` — Claude Code compatibility layer (kept intact until parity is verified).
- `.opencode/agents/*.md` — OpenCode implementation layer.

Both adapters point back here. If a role's definition changes, change it **here** first;
the adapters only carry tool-specific metadata (frontmatter, permission mappings, tool-call
behavior) plus a reference to this canonical file.

## Index

| Role | Purpose |
|---|---|
| [`architect`](architect.md) | Scopes cross-module/ambiguous work, protects architectural consistency, says no to unnecessary complexity |
| [`backend-engineer`](backend-engineer.md) | `apps/api`, `packages/db`, the Support Orchestrator, and Integrations |
| [`frontend-engineer`](frontend-engineer.md) | `apps/dashboard` and `apps/widget` |
| [`ai-engineer`](ai-engineer.md) | Prompts, RAG, embeddings, AI provider integration |
| [`security-reviewer`](security-reviewer.md) | Gate: auth, tenant isolation, secrets, permissions — veto power |
| [`qa-verifier`](qa-verifier.md) | Gate: real-execution verification before anything is called done |

The orchestrator (engineering lead) workflow lives in [`docs/workflows/orchestrator.md`](../workflows/orchestrator.md),
and the fixed-recurring workflow definitions live in [`docs/operators/README.md`](../operators/README.md).
