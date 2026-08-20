# Channel Integration

**Purpose:** Add a new customer communication channel (WhatsApp, email, voice, etc.) alongside the existing website widget.

**Status:** RESERVED — role defined, not invoked automatically or treated as an active workflow. Do not run until the trigger below occurs.

**Trigger / activation:** A first new channel is actually prioritized.

**Agents coordinated:** `architect` → `backend-engineer` → `security-reviewer` → `ai-engineer` (only if the channel changes prompt/context) → `qa-verifier`.

**Skills used:** none exist yet — write the channel-specific skill when the first real channel lands; don't pre-guess its shape.

**Workflow (at trigger time):** `architect` defines this channel's own context signals, per `docs/03_System_Architecture.md`'s explicit rule that the AI core is channel-agnostic but each channel's context is not and must never be assumed universal → `backend-engineer` builds the webhook/provider adapter feeding the existing `support-orchestrator.ts` core (not a parallel one) → `security-reviewer` reviews the new inbound-webhook auth surface (mandatory — every channel introduces a new one) → `ai-engineer` adjusts prompt/context if needed → `qa-verifier` verifies a real message round-trip.

**Boundaries:** Does not generalize a "universal channel model" in advance — each channel gets its own context design at its own trigger time, per the architecture doc's own warning against premature generalization.
