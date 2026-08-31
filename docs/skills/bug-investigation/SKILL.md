---
name: bug-investigation
description: Investigating a reported bug or unexpected error — project-specific triage steps, not generic debugging advice. Use when a bug or unexpected error is reported.
---

# bug-investigation

**For:** investigating a reported bug or unexpected error.

## Procedure

1. Reproduce against the real running system (curl/browser) first — a clean typecheck is not proof of correctness.
2. Bug appears only in the browser, not curl → suspect a header/body-shape issue (`Content-Type`, `FormData`) first.
3. Read `request.log` output and inspect the DB directly — there's no tracing/metrics system yet.
4. Client sees a generic 500 → check whether the throwing code uses a plain `Error` instead of an `AppError`.
5. Suspected tenant leak → run the two-workspace cross-check immediately (`tenant-isolation-review`), don't reason about it abstractly.
6. Suspected race → reproduce with genuinely concurrent requests, not sequential ones.
7. Unique-violation not caught as expected → check `error.cause?.code`, not just `error.code`.
8. Check `docs/07_Phase_Execution_Log.md` for the module before deep-diving — it may already be documented.

**Rule:** fix the root cause. Don't add a try/catch that just silences the symptom.

**Reference:** `apps/api/src/error-handler.ts`
