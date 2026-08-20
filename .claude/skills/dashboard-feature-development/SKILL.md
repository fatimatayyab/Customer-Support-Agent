---
name: dashboard-feature-development
description: Adding a page or feature to apps/dashboard, and keeping UI patterns (confirm dialogs, dark mode, a11y) consistent across it.
---

**For:** adding a page or feature to `apps/dashboard`, or keeping UI patterns consistent across it.

**Procedure:**
1. Route = `app/<route>/page.tsx`, `"use client"`.
2. All API calls go through `apiFetch<T>()` in `lib/api.ts` — never call `fetch` directly. Never manually set `Content-Type` — `apiFetch` already handles bodyless requests and `FormData`.
3. Catch `ApiError` specifically to surface a real backend message vs. a network failure.
4. Poll for list/status views (match the cadence of the page you're extending); use `lib/agent-console-ws-client.ts` for anything needing live push.
5. Gate role-restricted UI client-side **in addition to**, never instead of, the backend check.

**Reusable UI patterns — check before building a new one:** destructive/state-changing actions get the existing confirm-dialog pattern, not a new one per page; use the existing dark-mode tokens rather than hardcoding colors; every new page gets the same mobile/a11y pass the rest of the dashboard already has (recent work covered this per-module — Knowledge, Widget, Team, Integrations, Platform Owner — don't regress it for a new one).

**Reference:** `apps/dashboard/lib/api.ts`, `apps/dashboard/app/conversations/[id]/page.tsx`, `apps/dashboard/lib/agent-console-ws-client.ts`
