---
name: db-schema-migrations
description: Adding or changing a table, column, index, or RLS policy in packages/db. Use when making any schema/RLS/index/migration change.
---

# db-schema-migrations

**For:** adding or changing a table, column, index, or RLS policy in `packages/db`.

## Procedure

1. One entity (+ its enums) per file: `packages/db/src/schema/<entity>.ts`, exported from `index.ts`.
2. Apply the `tenant-isolation-review` skill's pattern.
3. A concept that doesn't fit an existing table's invariants gets its own table — not a nullable hack column.
4. Derive insert types with `Pick<typeof table.$inferInsert, "...">`.
5. `pnpm db:generate` → read the generated SQL before applying, especially RLS/index/custom-type clauses.
6. `pnpm db:migrate` to apply.
7. Assert a single-row `RETURNING` with `assertDefined()` — never a bare `!`.
8. If two requests could genuinely race to insert the same logical row, use a partial unique index — an
   app-level check-then-write is not sufficient.
9. When detecting a unique-violation, check both `error.code` and `error.cause?.code` — Drizzle wraps the
   raw driver error under `.cause`.

**Good result looks like:** generated SQL was actually read before applying, and a real
duplicate-insert/race was exercised if the table can race.

**Reference:** `packages/db/src/schema/vector-type.ts`, `packages/db/migrations/`
