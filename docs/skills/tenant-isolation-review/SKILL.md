---
name: tenant-isolation-review
description: Multi-tenant data isolation checklist for any workspace-owned table or auth/identification code — the highest-risk surface in this codebase. Use when touching tenant-scoped tables, RLS, BYPASSRLS paths, or auth/identification code.
---

# tenant-isolation-review

**For:** any change touching a workspace-owned table, or auth/identification code.

## Procedure

1. Table has `workspace_id uuid NOT NULL references workspaces.id`.
2. `pgPolicy` (using/withCheck on `current_setting('app.workspace_id')`) + `.enableRLS()` present.
3. An index touches `workspace_id` (composite if the query shape needs it).
4. Every repository function takes `ScopedDb` as its first param — never the raw `db` export.
5. The call site wraps in `withWorkspaceContext(workspaceId, cb)`.
6. Vector-search queries add an explicit `workspaceId` filter in the query itself — HNSW doesn't
   compose reliably with RLS alone.
7. Don't add a new BYPASSRLS path outside `auth-resolver-client.ts`. Extending it: grant only the
   specific columns needed, including any used only in a `WHERE` clause, not just returned ones.
8. A lookup by ID into another workspace's resource returns 404, not 403 — don't reveal existence.
   Exception: if the caller already holds a secret token for that exact resource (e.g. an invitation),
   a specific error is fine — no confidentiality benefit to vagueness there.

**Good result looks like:** two-workspace cross-check passes — workspace B cannot read or write
workspace A's rows, and status codes follow the 404 rule above.

**Reference:** `packages/db/src/tenant-context.ts`, `packages/db/src/auth-resolver-client.ts`,
`packages/db/src/schema/knowledge-chunks.ts` (pattern example)
