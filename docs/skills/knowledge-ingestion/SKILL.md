---
name: knowledge-ingestion
description: Adding an ingestible content type, or changing chunking/embedding, in the Knowledge module. Currently dormant (only plain_text/faq are implemented) but the schema already anticipates pdf/docx/website — keep this ready rather than reinvented under time pressure.
---

# knowledge-ingestion

**For:** adding an ingestible content type, or changing chunking/embedding, in `apps/api/src/modules/knowledge/`.

## Procedure

1. Place logic in the right file: `knowledge.routes.ts` / `.service.ts` / `*.repository.ts` /
   `embedding-provider.ts` / `chunker.ts` / `text-extraction.ts` / `website-extraction.ts`.
2. A new source type is a plain extraction function, not a new provider interface.
3. Reject an unimplemented type explicitly with a typed error — never silently half-support it.
4. Fast/CPU extraction (file parsing) → synchronous, before insert. Slow/network work (embedding, fetch) →
   un-awaited background job (`pending` → `processing` → `completed`/`failed`).
5. Batch calls to paid/rate-limited APIs sequentially, capped — never `Promise.all`.
6. Any URL-fetching step needs a timeout **and** a streamed byte-size cap (abort mid-stream, don't buffer then check).
7. Any endpoint accepting a URL needs the SSRF guard (reject `localhost`/`.local`/private IPs before fetching).

**Good result looks like:** a real source of the new type reaches `completed`, and a real search query
retrieves it, ranked correctly.

**Reference:** `apps/api/src/modules/knowledge/knowledge.service.ts`, `chunker.ts`, `website-extraction.ts`,
`text-extraction.ts`
