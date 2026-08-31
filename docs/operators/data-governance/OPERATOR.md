# Data Governance (Tenant Export / Deletion)

**Purpose:** Export or delete all data for a given workspace on request (compliance, offboarding).

**Status:** DEFERRED — placeholder only, no workflow defined yet. Do not treat this as an active workflow.
No roadmap evidence this is coming; listed proactively because the tenant-isolation model already makes it
cheap to act on if it does.

**Trigger / activation:** An actual compliance requirement (e.g. GDPR data-subject request) or
customer-offboarding request.

**Roles coordinated:** Likely `security-reviewer` (completeness/audit) + `backend-engineer` (implementation)
+ `qa-verifier`, but not finalized until the trigger clarifies real requirements — a legal deletion
obligation and a contractual offboarding request may need different guarantees.

**Skills used:** `tenant-isolation-review` — its per-table, workspace-scoped checklist already gives the
inventory this workflow would need to walk.

**Workflow:** To be designed at trigger time.

**Boundaries:** This file marks the category as anticipated. It is not a runnable workflow and must not be invoked.
