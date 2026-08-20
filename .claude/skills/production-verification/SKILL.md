---
name: production-verification
description: The bar for calling any feature done — there is no automated test suite, so this is the real verification. Canonical procedure for the qa-verifier agent.
---

**For:** before calling any feature done. Canonical procedure for `qa-verifier`.

**Procedure:**
1. `pnpm -r run typecheck` clean across affected packages.
2. `pnpm docker:up`; confirm Postgres (port 5433) and Redis are healthy.
3. Start the relevant app(s): `pnpm dev:api` / `dev:dashboard` / `dev:widget`.
4. Exercise the real path:
   - API-only → curl, success + at least one failure/edge case.
   - Realtime → a real WS client, not just the HTTP handshake.
   - UI → real browser, console + network tab clean.
5. Two-workspace cross-check (`tenant-isolation-review` skill) for any workspace-scoped table or new endpoint.
6. Confirm migration generated/inspected/applied if schema changed.
7. Remove any test data created during verification — **explicitly include `workspace_signup_invites`** if the test provisioned a disposable workspace via a signup link. That table has no `workspace_id` column (it exists to gate workspace creation *before* a workspace exists), so "delete the workspace and its cascaded rows" never touches it — the consumed invite row is orphaned otherwise. (Confirmed the hard way: two rows sat unnoticed for days before being caught.)
8. Re-read the diff once, specifically for security/tenant-isolation/race issues, before calling it done.
9. If this completes or meaningfully advances a phase, update `docs/07_Phase_Execution_Log.md` in the same unit of work.

**Good result looks like:** every applicable step above actually run against the real system, not inferred from types — and nothing left in the DB that verification created.

**Reference:** `CLAUDE.md` §5, §6
