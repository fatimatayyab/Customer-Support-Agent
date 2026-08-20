# Operators

An Operator is a named, fixed-shape workflow for one *specific* recurring class of work — distinct from the Orchestrator (`.claude/commands/orchestrator.md`), which classifies and delegates arbitrary tasks, and from Agents/Skills, which each own one specialist responsibility or procedure. An Operator coordinates existing Agents against a sequence proven (or strongly anticipated) to be stable enough to be worth encoding once, rather than re-derived by the Orchestrator's classification every time.

Each Operator has a folder here (`.claude/operators/<name>/OPERATOR.md`) defining its purpose, status, trigger, agents, skills, workflow, and boundaries. **Only an `ACTIVE` Operator is wired up as a real, invokable `.claude/commands/*.md` file.** `RESERVED` and `DEFERRED` entries are documentation only — they live exclusively under `.claude/operators/`, a location Claude Code does not scan for invokable commands, so they cannot be triggered automatically or mistaken for a live workflow. They activate only when a human deliberately builds the corresponding command file, after the stated trigger has occurred.

## ACTIVE

- **[architecture-readiness-review](architecture-readiness-review/OPERATOR.md)** — whole-diff or whole-repo consistency sweep against a fixed rubric. Coordinates `architect` + `security-reviewer`. Executable at `.claude/commands/architecture-readiness-review.md`. Proven recurring practice, not hypothetical — see `docs/07_Phase_Execution_Log.md`, Phase 2 and Phase 4, "Pre-Commit Architecture Review."

## RESERVED — role defined, build only when the trigger fires

Each of these has a workflow shape already knowable today, derived from a pattern or rule this repo has already committed to.

- **[crm-integration](crm-integration/OPERATOR.md)** — onboarding a second CRM provider. Trigger: one actually gets scoped.
- **[channel-integration](channel-integration/OPERATOR.md)** — onboarding a new communication channel (WhatsApp, email, voice, etc.). Trigger: a first one actually gets prioritized.
- **[ai-evaluation](ai-evaluation/OPERATOR.md)** — prompt/provider regression checking. Trigger: an eval dataset/harness actually gets built.

## DEFERRED — no spec yet; the trigger itself will reveal the shape

Unlike RESERVED, these can't be usefully speced today — the missing piece isn't a second instance of a known pattern, it's the underlying tooling or data the workflow would need to be designed around. Their folders exist as placeholders so the category isn't forgotten, not as workflows to run.

- **[production-operations](production-operations/OPERATOR.md)** — incident response. Trigger: structured observability/error-tracking exists and the product has real production traffic.
- **[performance-optimization](performance-optimization/OPERATOR.md)** — recurring bottleneck resolution. Trigger: real profiling data shows a recurring pattern (may end up folded into `architecture-readiness-review` instead of becoming its own Operator).
- **[data-governance](data-governance/OPERATOR.md)** — workspace data export/deletion. Trigger: an actual compliance or offboarding request.

## Rejected — not Operator-shaped, kept out of the folder structure

No folder or `OPERATOR.md` exists for these; the rationale is preserved here only, so it isn't relitigated without a new reason.

- **Bug Resolution** — the Orchestrator's classification plus the `bug-investigation` skill already fully cover this; more modules just means more routing, not a new coordination shape.
- **Client/SDK Installation** *(reassessed against React / React Native / Flutter / PHP / plain web)* — the web-embed case (React, Vue, PHP-rendered HTML, plain JS) is already a single universal `<script>` tag; adding a framework wrapper there is documentation/packaging work for `frontend-engineer` alone, never multi-agent. The one slice with a real multi-agent shape — a genuinely native mobile SDK (React Native/Flutter) needing its own non-cookie auth mechanism — would introduce a new credential-distribution surface, which *is* security-relevant. But that's just an ordinary new-module feature (`architect` scopes it, `backend-engineer` builds the auth path, `security-reviewer` reviews it, `qa-verifier` verifies) the Orchestrator already routes correctly on its own; there's no distinct recurring *installation* workflow underneath it, and no roadmap evidence (`docs/00`–`03`, `Project_Overview.md`) that native mobile is even a target platform. Revisit only if that changes — and even then, expect it to be handled as a normal cross-module feature, not a new Operator.
- **Customer/Workspace Onboarding** — a business/CS process, not a recurring engineering-coordination problem. The part that does recur — improving the self-serve setup feature — is ordinary Orchestrator-routed feature work.
- **Billing/Subscription** — not even vendor-decided yet; typically a one-time integration followed by vendor-dashboard-absorbed operations, not a repeating multi-agent workflow.
