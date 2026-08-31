# AGENTS.md

**This document defines *who* builds the product.**
**`docs/` is the durable, tool-neutral source of truth.** `CLAUDE.md` (Claude Code) and `.claude/` are a
compatibility layer; `.opencode/` is the OpenCode implementation layer. Both are thin adapters over
`docs/` — they do not carry a second copy of the project's core knowledge.

The engineering/architecture rules, security guardrails, and definition of done live in **`docs/`**:
- Role definitions — `docs/roles/`
- Recurring-task skills/SOPs — `docs/skills/`
- Fixed recurring workflows (Operators) — `docs/operators/`, indexed in `docs/operators/README.md`
- Coordination workflows — `docs/workflows/` (notably `docs/workflows/orchestrator.md`)
- Architectural rules, conventions, and guardrails — see `docs/00`–`06`, `docs/05_Engineering_Bible.md`

Work is coordinated by the Orchestrator (`docs/workflows/orchestrator.md`), not by manually invoking roles
in sequence — see that file for how classification, delegation, and gating actually work.

---

## 1. The Team

| Role | Purpose |
|---|---|
| [`architect`](docs/roles/architect.md) | Scopes cross-module/ambiguous work, protects architectural consistency, says no to unnecessary complexity |
| [`backend-engineer`](docs/roles/backend-engineer.md) | `apps/api`, `packages/db`, the Support Orchestrator, and Integrations |
| [`frontend-engineer`](docs/roles/frontend-engineer.md) | `apps/dashboard` and `apps/widget` |
| [`ai-engineer`](docs/roles/ai-engineer.md) | Prompts, RAG, embeddings, AI provider integration |
| [`security-reviewer`](docs/roles/security-reviewer.md) | Gate: auth, tenant isolation, secrets, permissions — veto power |
| [`qa-verifier`](docs/roles/qa-verifier.md) | Gate: real-execution verification before anything is called done |

Final static review (duplication, dead code, architectural drift) is the built-in code-review capability of
whichever tool runs the session, not a custom role — no need to reimplement it.

---

## 2. Workflow

```
Orchestrator classifies the task
        ↓
architect            (only for cross-module / ambiguous / expensive-to-reverse work)
        ↓
backend-engineer / frontend-engineer / ai-engineer   (only the ones the task touches, parallel or sequential)
        ↓
Architecture & Readiness Review   (non-trivial changes — fixed rubric sweep, see docs/operators/)
        ↓
security-reviewer    (mandatory whenever auth, tenant data, secrets, or permissions are in the diff)
        ↓
qa-verifier           (always)
        ↓
final code review     (always, final gate)
        ↓
Feature Complete
```

A feature isn't complete until it has cleared every applicable stage — skipping one because a change "looks
simple" is how simple changes become incidents. Unresolved disagreement between roles escalates to the user.
