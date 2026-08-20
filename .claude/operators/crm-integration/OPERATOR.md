# CRM Integration

**Purpose:** Onboard a new CRM/external-data provider (Salesforce, Zoho, Pipedrive, etc.) alongside the existing HubSpot integration.

**Status:** RESERVED — role defined, not invoked automatically or treated as an active workflow. Do not run until the trigger below occurs; there is currently nothing real for this Operator to coordinate.

**Trigger / activation:** A second CRM provider is actually requested or scoped.

**Agents coordinated:** `architect` → `backend-engineer` → `security-reviewer` → `qa-verifier`.

**Skills used:** `integration-action`, `tenant-isolation-review`.

**Workflow (at trigger time):** `architect` decides whether this provider warrants OAuth2 or a more generalized connector interface (the existing `IntegrationProvider` interface was already built vendor-neutral for exactly this, per `docs/07_Phase_Execution_Log.md` Phase 5) → `backend-engineer` implements the provider file plus the credential flow via `credential-crypto.ts` → `security-reviewer` reviews credential/OAuth handling (mandatory) → `qa-verifier` verifies against the real vendor API/sandbox, not a mock.

**Boundaries:** Coordinates agents only — does not itself define the vendor contract or implement code; those decisions belong to `architect`/`backend-engineer` at trigger time. Not to be invoked speculatively.
