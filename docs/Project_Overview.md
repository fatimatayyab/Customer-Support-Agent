# So, what are we building?

Picture a small business — say a textile exporter, or a clinic, or a logistics company. They get the same customer questions over and over: "where's my order," "what's your return policy," "do you ship to X." Right now they either pay a team of people to answer the same ten questions all day, or customers just don't get answered fast enough and go elsewhere.

That's the problem. The product is an AI customer support platform — think of it as a lightweight Intercom or Zendesk, but with an AI that actually answers questions using the business's own knowledge, instead of a generic chatbot that hallucinates or just deflects to a human every time.

A business signs up, drops a little chat bubble on their website, uploads their FAQs and docs (or a PDF, or just points us at their existing help pages), and their customers can start chatting immediately. The AI answers using *that specific business's* knowledge — and when it's not confident, or the question is something only a human should touch, it hands off to a real support agent seamlessly, mid-conversation, without the customer having to repeat themselves.

## The vision

The guiding idea, from day one, has been: **the AI is a helpful employee, not the boss.** It doesn't get to make business decisions, it doesn't get direct access to the database or to a business's other tools, and it never gets to just wing it. There's always a layer of actual application logic sitting between "what the AI wants to say" and "what actually happens" — deciding whether an answer is grounded enough to send, whether to escalate, what's safe to show the customer versus what's just an internal note for the agent.

Longer-term, the plan is for this to become the operational brain a small business plugs into everything: it should be able to look things up in their CRM, check an order status in Shopify, eventually take real actions ("let's issue this refund," "let's rebook this appointment") — always through the same disciplined AI-is-a-service pattern. We're a good way toward that already (more below).

We're deliberately building this for a *first real design partner*, not chasing every feature on a roadmap. A while back we paused the planned phase-by-phase build to go fix the two things that would actually stop a real customer from using this — you couldn't invite a teammate, and you couldn't upload a PDF. Both of those were done quickly, and since then we've kept applying the same test — "what would actually break for a real customer, or actually embarrass us in production" — rather than mechanically working down the original roadmap. That's what pulled automated tests, rate limiting, and WebSocket reconnect logic in ahead of anything else, and it's also what's currently pulling in the first slice of analytics.

## The tech, and why

It's a monorepo (pnpm workspaces) with three deployable pieces and two shared packages:

- **The API** (`apps/api`) — a Fastify server in TypeScript. This is the brain. We picked Fastify over Express mainly for its built-in schema validation and cleaner plugin model — it just fits a TypeScript-first codebase better.
- **The dashboard** (`apps/dashboard`) — Next.js + React, where a business's staff manage their account, knowledge base, team, and live conversations.
- **The widget** (`apps/widget`) — a tiny Preact bundle that gets embedded on a customer's website. It's Preact instead of React specifically because it's ~4KB instead of ~40KB — every kilobyte here is loading on somebody else's site, on every visitor, so size actually matters.
- **The database** — Postgres, with the pgvector extension for AI embeddings, via Drizzle ORM. We picked Drizzle over the more popular Prisma for one specific reason: it lets us write our row-level security policies (more on that in a second) directly as part of the schema code, which Prisma can't do.
- **The AI itself** — we support both Google Gemini and Anthropic's Claude behind a simple swap (an env variable). Gemini is the default just because it has a usable free tier, so nobody burns real API budget just running the app locally. Claude is fully wired up and one line away whenever we want it live.
- Embeddings (the "meaning as numbers" that power search) come from Voyage AI — it's what Anthropic themselves recommend pairing with Claude for this kind of retrieval work.
- **Redis** — provisioned since day one but sat unused for a long time; it's now doing real work as the backing store for rate limiting (login/signup, knowledge ingestion, invitations, chat messages all have real limits now), and it's the obvious next tool to reach for once real-time fan-out needs to work across more than one API instance.

Nothing exotic here. The stack is boring on purpose — we'd rather spend cleverness on the product than on infrastructure.

## How it actually works

A customer opens the chat widget and sends a message. That message travels over a WebSocket (so replies come back instantly, no polling) to the API, which figures out which business ("workspace" is our word for a tenant) this widget belongs to, saves the message, and immediately broadcasts it back out so it shows up in the chat.

Then, if nobody's currently handling this conversation, here's the fun part: the system goes and searches that business's knowledge base for anything relevant (using the embeddings/pgvector search mentioned above), hands that context plus the conversation to the AI, and asks it to draft a reply. But there's a hard rule in code, not just a prompt instruction: if nothing relevant was actually found, the AI never even gets called — the system just says "let me get someone to help" and flags the conversation for a human. No relevant knowledge, no guessing. Even when the AI *does* answer, if it's not confident, the conversation still gets flagged for a human to check in — but the customer still gets the AI's honest answer in the meantime, rather than being left hanging.

The moment a support agent claims that conversation from the dashboard, the AI just... stops. No flag to flip, no process to cancel — the code simply never asks it to reply for that conversation again once a human owns it. The agent can reply directly, leave private notes only the team can see, ask the AI for a quick suggested reply or a conversation summary to save time, and — if the business has connected something like HubSpot — pull up the customer's real CRM record without leaving the console.

A customer can also ask for a human directly ("can I talk to someone"), not just wait for the AI to decide it's stuck — either way, they're offered a quick "leave your name and contact info" form right in the chat, entirely optional. It's saved and visible right on the conversation, with who still needs to be followed up with easy to find in the dashboard queue. It also quietly mirrors into an internal Airtable we (the platform team) watch across every business on the platform — that's our own tool for catching a struggling customer early during this design-partner phase, not something any business configures or even sees; nothing about a business's own follow-up depends on it.

Every single one of these businesses is completely walled off from every other one. That's not just an app-level check — it's enforced two different ways at once (application logic *and* the database itself refuses to return another business's rows), because with a multi-tenant product, "a customer's data leaked to a different customer" is the one mistake that's genuinely unacceptable.

## What's actually built and working today

Quite a lot, honestly:

- **The whole core loop** — sign up, embed the widget, chat live with a real AI reply grounded in real uploaded knowledge, or escalate to a human. This has been true for a while now and it works end-to-end.
- **The knowledge base** — you can paste text, upload a PDF or a Word doc, or just paste in a handful of URLs and we'll pull the content and index it, all automatically chunked and embedded and searchable.
- **The agent console** — a real queue of conversations, claiming, reassigning, internal notes, AI-assisted suggested replies and summaries.
- **One outside integration a business connects themselves** — HubSpot, where an agent working a conversation can pull up that customer's actual CRM contact.
- **Human escalation, either direction** — a customer can explicitly ask for a human mid-chat, not just get escalated by the AI's own judgment call. Either way, they're offered an optional contact form so a team member can follow up even if nobody's watching the live chat right then. That contact also mirrors into our own internal Airtable (platform-wide, not per-business) so we can keep an eye on escalations across every workspace during this design-partner phase — invisible to the business itself, purely our own operational tool.
- **Team management** — invite teammates by email with a shareable link, assign them a role (owner, admin, support agent), and they're in. (Right now it's copy-link only — no actual email gets sent yet — but the whole thing is built so that plugging in a real email provider later is a tiny change, not a rebuild.)
- **An automated test suite** — not exhaustive, but it covers the part that actually matters most: every tenant-isolation boundary (a generic, schema-driven check that fails loudly if a new table ever ships without it) and the Support Orchestrator's business logic, running against a real Postgres database, not mocks.
- **Rate limiting** on the endpoints that either cost real money per request (AI replies, knowledge-base embedding) or are realistic abuse targets (login, signup, invitations) — backed by Redis, which had been sitting provisioned-but-unused since day one.
- **WebSocket reconnect logic**, in both the widget and the agent console — an API restart or network blip used to leave a live chat silently dead until someone reloaded the page; now both sides detect the drop, show it, and recover on their own.
- **A first analytics dashboard** — conversation volume, resolution and escalation rates, why conversations escalate, AI performance (confidence, provider/model split, token usage), which knowledge sources actually get used, and now a lightweight customer-satisfaction rating (a thumbs up/down a customer can leave on their chat). All read-only over data the product was already recording; the CSAT rating is the one genuinely new thing it started collecting.

## What's in progress or still missing

- **No real email sending** for invitations yet — just the copy-link. The interface is built for it; no provider is plugged in.
- **Only one outside integration a business connects themselves** (HubSpot, one action — pulling up a contact). The design supports adding more easily, but nothing else is wired up yet, and it's deliberately waiting for a second real use case before generalizing the interface further.
- **No billing or subscription management** — the last item from the original MVP scope that hasn't been touched at all. No schema, no payment provider, nothing. That's a real vendor decision (almost certainly Stripe) someone needs to make before it's worth building.
- **No additional chat channels** (WhatsApp, email, etc.) — the website widget is the only one today.
- **Analytics is read-only and reactive, not yet prescriptive** — it tells you what happened, but there's no "here's what you should do about it" layer (e.g. "your knowledge base is missing an answer for X") yet. That needs a product decision about what a useful recommendation even looks like before it's worth building.
- **A few operational basics still aren't there** — no pagination on lists, no CI pipeline, no structured error tracking/observability, no Dockerfiles for the apps themselves (Docker Compose only covers local Postgres/Redis). Fine for where we are now, not fine forever.

So the honest picture: the product genuinely works, start to finish, for a real business today, and the parts most likely to embarrass us in production (data leaking across tenants, an untested Orchestrator, unlimited-cost API abuse, a chat that silently dies) have real coverage now. What's left is mostly billing (to actually charge someone), rounding out the "connect it to more of your other tools" story, and production-operations basics — not proving the core idea works, because it already does.
