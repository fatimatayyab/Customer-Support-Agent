---
name: ai-provider-management
description: Adding an AI provider, changing prompts, or adjusting confidence/escalation behavior.
---

**For:** adding a provider, changing prompts, or adjusting confidence/escalation in `apps/api/src/modules/ai/`.

**Procedure:**
1. New provider = one file in `modules/ai/providers/` implementing `AiProvider` + one `case` in `ai.service.ts`'s `createAiProvider()`. Nothing else should need to change.
2. `provider`/`model`/`promptVersion` are set by the provider itself inside its result — never assumed by the caller.
3. Use forced tool/function-calling against the shared schema in `prompts/support-reply.prompt.ts` — not prompted JSON.
4. Prompt text/schema lives in `modules/ai/prompts/`, never inline in a provider file. Bump the `*_PROMPT_VERSION` constant on any meaningful wording/schema change.
5. Tuning values live in `ai.config.ts` — don't inline magic numbers.
6. Cap any history sent to a provider with `MAX_HISTORY_MESSAGES`.
7. Preserve the retrieval floor: below `MIN_RELEVANCE_SIMILARITY`, skip the provider call entirely — don't rely on prompt wording alone.
8. Show the model's own reply even when low-confidence or self-escalating. Only zero-relevant-chunks and provider failure get a hardcoded fallback.

**Good result looks like:** a real call covering a grounded question, an off-topic question, and an induced provider failure — `messages.metadata.provider`/`promptVersion` recorded, citations only from the calling workspace's own knowledge.

**Reference:** `apps/api/src/modules/ai/ai-provider.ts`, `ai.service.ts`, `ai.config.ts`, `providers/*.ts`
