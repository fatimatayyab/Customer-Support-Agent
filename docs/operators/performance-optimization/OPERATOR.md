# Performance Optimization

**Purpose:** Diagnose and resolve a recurring performance bottleneck category (query performance, realtime
fan-out, embedding throughput, etc.).

**Status:** DEFERRED — placeholder only, no workflow defined yet. Do not treat this as an active workflow.

**Trigger / activation:** Real production load or profiling data identifies a *recurring* bottleneck pattern
— not a one-off fix. (The already-anticipated Redis-backed multi-instance realtime fan-out noted in
`docs/Project_Overview.md` is a one-time architecture migration, not a recurring workflow, and doesn't by
itself trigger this.)

**Roles coordinated:** Not yet defined.

**Skills used:** None yet.

**Workflow:** To be designed at trigger time. Check first whether the need is better served by extending
`architecture-readiness-review`'s existing performance dimension rather than standing up a separate
Operator — it may turn out one is unnecessary.

**Boundaries:** This file marks the category as anticipated. It is not a runnable workflow and must not be invoked.
