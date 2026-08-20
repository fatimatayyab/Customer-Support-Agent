# AGENTS.md

**This document is the team roster.** `CLAUDE.md` defines *how* we build (conventions, guardrails, architecture rules). This document defines *who* builds it. Each role's full prompt — expertise, responsibilities, boundaries, expected output — lives in `.claude/agents/<name>.md`; this file is the index and the workflow, not a second copy of those prompts.

Work is coordinated by the Orchestrator (`.claude/commands/orchestrator.md`), not by manually invoking roles in sequence — see that file for how classification, delegation, and gating actually work. For the handful of fixed, recurring workflows that justify their own coordination sequence instead of ad hoc classification, see `.claude/operators/README.md`.

---

## 1. The Team

| Agent | Purpose |
|---|---|
| [`architect`](.claude/agents/architect.md) | Scopes cross-module/ambiguous work, protects architectural consistency, says no to unnecessary complexity |
| [`backend-engineer`](.claude/agents/backend-engineer.md) | `apps/api`, `packages/db`, the Support Orchestrator, and Integrations |
| [`frontend-engineer`](.claude/agents/frontend-engineer.md) | `apps/dashboard` and `apps/widget` |
| [`ai-engineer`](.claude/agents/ai-engineer.md) | Prompts, RAG, embeddings, AI provider integration |
| [`security-reviewer`](.claude/agents/security-reviewer.md) | Gate: auth, tenant isolation, secrets, permissions — veto power |
| [`qa-verifier`](.claude/agents/qa-verifier.md) | Gate: real-execution verification before anything is called done |

Final static review (duplication, dead code, architectural drift) is the built-in `/code-review` skill, not a custom agent — no need to reimplement what Claude Code already ships.

---

## 2. Workflow

```
Orchestrator classifies the task
        ↓
architect            (only for cross-module / ambiguous / expensive-to-reverse work)
        ↓
backend-engineer / frontend-engineer / ai-engineer   (only the ones the task touches, parallel or sequential)
        ↓
Architecture & Readiness Review Operator   (non-trivial changes — fixed rubric sweep, see .claude/operators/)
        ↓
security-reviewer    (mandatory whenever auth, tenant data, secrets, or permissions are in the diff)
        ↓
qa-verifier           (always)
        ↓
/code-review          (always, final gate)
        ↓
Feature Complete
```

A feature isn't complete until it has cleared every applicable stage — skipping one because a change "looks simple" is how simple changes become incidents. Unresolved disagreement between agents escalates to the user (`CLAUDE.md` §1).
