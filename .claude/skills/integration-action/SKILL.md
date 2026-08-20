---
name: integration-action
description: Adding an action to an existing external integration provider, or a new provider. Currently only HubSpot exists, but the interface/audit-log already generalize beyond it.
---

**For:** adding an action to an existing provider, or a new provider, in `apps/api/src/modules/integrations/`.

**Procedure:**
1. Name the interface method for the business capability, not the vendor (`lookupContact`, not `getHubSpotContact`). Result types are vendor-neutral fields, not a passthrough of the vendor's raw response.
2. Confine vendor knowledge to the provider implementation file and the audit log's `provider` field — route/Orchestrator stay vendor-neutral.
3. `integration.service.ts` is the only place selecting the concrete provider class (per-workspace, not env-selected).
4. Encrypt credentials via `jose` JWE (`credential-crypto.ts`) — don't hand-roll crypto.
5. Verify credentials before storing them.
6. Wrap credential-decryption **and** the provider call in one try/catch feeding the audit log.
7. Log every attempt, success or failure, to `integration_action_logs` (FK `ON DELETE SET NULL`, not cascade).
8. Decide deliberately per action whether the result is customer-visible — default to agent-only (`conversation_notes`), never a broadcast message, unless there's a stated reason.
9. Don't build a generic multi-provider connector before a second concrete provider exists.

**Good result looks like:** a bad credential produces a real vendor-side error (not a mock); credential encryption round-trips correctly; a failed action produces no `conversation_notes` entry.

**Reference:** `apps/api/src/modules/integrations/integration-provider.ts`, `integration.service.ts`, `credential-crypto.ts`, `providers/hubspot-integration-provider.ts`
