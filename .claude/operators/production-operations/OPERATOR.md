# Production Operations (Incident Response)

**Purpose:** Detect → triage → mitigate/rollback → root-cause → postmortem for production incidents.

**Status:** DEFERRED — placeholder only, no workflow defined yet. Unlike the RESERVED operators, the shape here isn't knowable from an existing pattern in this repo; it depends on tooling that doesn't exist yet. Do not treat this as an active workflow.

**Trigger / activation:** Structured observability/error-tracking is actually built, and the product carries real production traffic depending on uptime.

**Agents coordinated:** Not yet defined — depends on what the eventual observability signals turn out to be.

**Skills used:** `bug-investigation` covers today's manual-triage reality (no tracing/metrics system exists yet); a dedicated incident skill would be written once real signals exist.

**Workflow:** To be designed at trigger time, informed by the actual instrumentation built at that point — not speced in advance.

**Boundaries:** This file marks the category as anticipated. It is not a runnable workflow and must not be invoked.
