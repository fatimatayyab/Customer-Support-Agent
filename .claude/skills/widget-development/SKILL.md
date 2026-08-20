---
name: widget-development
description: Changing widget UI, connection handling, or embed mechanics in apps/widget.
---

**For:** changing widget UI, connection handling, or embed mechanics in `apps/widget`.

**Procedure:**
1. Mount inside the existing Shadow DOM root (`main.tsx`) — never `document.body` directly.
2. Weigh bundle-size cost before adding any dependency.
3. Keep the connection lazy — connect on first bubble-open, not on load.
4. Keep the ticket handshake for WS auth (`POST /widget/session` → `GET /widget/ws?ticket=...`). Never put the API key in the WS URL.
5. Persist `customerId`/`conversationId` via `storage.ts` on the host page's own origin.
6. Keep the build a single IIFE (`vite.config.ts`: `formats: ["iife"]`, `cssCodeSplit: false`) — one `<script>` tag, no chunking.
7. No Playwright coverage exists for the widget yet — say so explicitly if verification was manual only.

**Good result looks like:** verified against the **built** bundle via `example/index.html` (not the dev server) — bubble open/close, message send/receive, and the typing indicator all work.

**Reference:** `apps/widget/src/main.tsx`, `ws-client.ts`, `vite.config.ts`, `example/index.html`
