# AI Evaluation / Prompt Regression

**Purpose:** Evaluate whether a prompt or AI-provider change regresses reply quality before it ships.

**Status:** RESERVED — role defined, not invoked automatically or treated as an active workflow. Do not run until the trigger below occurs.

**Trigger / activation:** An actual eval dataset/harness gets built.

**Agents coordinated:** `ai-engineer` → `architect` → `qa-verifier`.

**Skills used:** `ai-provider-management`.

**Workflow (at trigger time):** `ai-engineer` implements the prompt/provider change → run the eval set, compare confidence/citation-correctness before vs. after → `architect` judges whether any regression is acceptable to ship → `qa-verifier` does final verification.

**Boundaries:** Does not define the eval dataset or scoring methodology itself — that's a prerequisite that must exist before this Operator activates. `provider`/`promptVersion`/`confidence` are already recorded per-message (`docs/07` Phase 3), so this Operator needs only the harness, not new instrumentation.
