# Eval Seed Set — Collection Process

V1.x "start collecting real transcripts toward an eval seed set" (`docs/09` §V1.x). This is the **raw
material** for the RESERVED `ai-evaluation` Operator (`docs/operators/ai-evaluation/OPERATOR.md`), which
activates only once an actual eval dataset/harness is built (V2). Nothing here is the harness itself —
it is an append-only archive of real transcripts with the per-message metadata already captured.

## How to collect (read-only)

- **Source:** production Supabase, workspace **Build IQ** (`360ec487-4437-4cd5-b363-c5ffb551ec68`). Read-only
  `SELECT`s only — never write to production, never mutate a published batch.
- **Extraction shape (what the first batch used):** conversations (id, status, created, `metadata.escalation`),
  messages (sender_type, UTC timestamp, content, and for `ai` messages: `metadata.provider/model/confidence/
  promptVersion/finishReason/citations`), plus `conversation_ratings`. Group into conversation objects.
- **Append-only:** one JSONL file per workspace per calendar month — `eval-seed/<workspace>/<YYYY-MM>.jsonl`.
  New traffic adds a new batch file; a published batch is never rewritten.

## Format (JSONL — one conversation per line)

```jsonc
{
  "conversationId": "uuid",
  "collectedAt": "ISO timestamp of extraction",
  "source": "buildiq-live",
  "createdAt": "conversation created ISO",
  "status": "open | escalated | ...",
  "escalation": { "reason": "no_relevant_knowledge | low_confidence | ai_requested_escalation | ai_provider_error | customer_requested_human" } | null,
  "outcome": "deflected | escalated",   // deflection = no escalation AND no agent messages AND no assignment (docs/09; matches the analytics deflection-rate definition)
  "csat": "up | down | null",
  "turns": [
    { "role": "customer", "ts": "...", "content": "..." },
    { "role": "system", "ts": "...", "content": "..." },
    { "role": "ai", "ts": "...", "content": "...",
      "provider": "gemini", "model": "gemini-2.5-flash", "confidence": 0.8,
      "promptVersion": 6, "finishReason": "STOP",
      "citations": [ { "knowledgeChunkId": "uuid", "knowledgeSourceId": "uuid", "similarity": 0.35 } ] }
  ]
}
```

## Rules

- **PII:** redact before committing a batch — emails → `[email]`, phone numbers → `[phone]`, names → `[name]`.
  (The first batch contains none.)
- **Historical-KB caveat:** AI replies generated before the 2026-08-28 16:48 KB re-ingestion cite source/chunk
  IDs from a superseded KB version; those citations do **not** resolve against the current KB
  (`buildiq-company-and-services-knowledge-base`, `buildiq-support-agent-product-faq`). Tag them "historical KB
  version" for any citation-resolution check; prefer post-re-ingestion replies.
- **Do not** modify production data; read-only extraction only.

## Relationship to operators

The harness that consumes this seed set is the V2 build that activates `docs/operators/ai-evaluation/
OPERATOR.md`. Until then this archive just accumulates real question distribution.