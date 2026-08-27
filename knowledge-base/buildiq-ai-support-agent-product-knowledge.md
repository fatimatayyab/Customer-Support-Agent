# BuildIQ AI Support Agent — Product Knowledge

This document describes BuildIQ's AI Support Agent: what it is, what it can do today, how it works, and what is planned for the future. It is written for prospective and current BuildIQ customers.

Status labels used throughout this document:

- **AVAILABLE NOW** — works today, out of the box, no extra setup.
- **CONFIGURATION/INTEGRATION REQUIRED** — works today, but only after a workspace owner or administrator connects or enables it.
- **PLANNED** — on the roadmap, not yet available to customers.
- **NOT CURRENTLY SUPPORTED** — explicitly out of scope for the current release; not a hidden or in-progress feature.

Any capability not labeled AVAILABLE NOW or CONFIGURATION/INTEGRATION REQUIRED should be treated as not currently usable, even if it sounds like a natural extension of an existing feature.

---

## 1. What BuildIQ's AI Support Agent Is

BuildIQ's AI Support Agent is an AI-powered customer support product built into the BuildIQ platform. A business (a "workspace" in BuildIQ) uploads its own support knowledge, embeds a chat widget on its website, and the AI Support Agent handles incoming customer conversations directly — answering questions grounded in that business's own knowledge, performing a narrow set of approved actions, and handing off to a human agent whenever a conversation needs one.

It is not a generic chatbot that improvises answers from general internet knowledge. It is designed to act as the first line of a business's support team: answering repetitive, well-documented questions accurately, and escalating anything it cannot answer confidently and safely to a human.

Behind the scenes, the platform coordinates every conversation as one consistent flow: loading conversation history, retrieving relevant knowledge, generating an AI response, deciding whether an approved action or a human handoff is needed, and recording everything for analytics. The AI itself never directly calls external systems or makes authorization decisions on its own — it produces a response and a recommendation, and the platform enforces what actually happens next.

---

## 2. Who It's For and What Problems It Solves

BuildIQ's AI Support Agent is built primarily for small and medium-sized businesses that run their own customer support, including e-commerce, SaaS companies, healthcare clinics, educational institutions, agencies, and professional services firms. Support for larger enterprise organizations is a future direction, not the current focus.

It addresses common support pain points:

- **High volumes of repetitive questions** that consume agent time without needing a human's judgment.
- **Slow response times**, especially outside business hours.
- **Rising support costs** as ticket volume grows faster than headcount.
- **Scattered knowledge** — answers that exist somewhere, but aren't easy for a chatbot (or a new hire) to find and use correctly.
- **Inconsistent answers** across different agents or channels.
- **Limited visibility** into what customers are actually asking and where support is failing.

Rather than replacing a support team, the AI Support Agent is designed to absorb the repetitive share of incoming conversations and route everything else — ambiguous requests, account-specific issues, anything requiring judgment — to a human, with full context already attached.

---

## 3. How It Works, at a High Level

1. A customer opens the chat widget on the business's website and asks a question.
2. The AI Support Agent retrieves the most relevant pieces of that business's own knowledge base using semantic (meaning-based) search, not simple keyword matching.
3. The AI generates a reply grounded specifically in that retrieved knowledge, along with a confidence assessment.
4. If the AI determines it can answer safely and confidently, the reply is sent to the customer in real time.
5. If the AI has no relevant knowledge to draw on, has low confidence, encounters an error, or the customer explicitly asks for a human, the conversation is escalated and a human support agent can take over.
6. If a human agent has already taken over a conversation, the AI stays silent — it does not generate further replies once a person is actively handling that conversation.
7. Every conversation, AI reply, and escalation is recorded for the business's own analytics.

This flow runs over a real-time connection (the widget updates live, including a "typing" indicator while the AI is generating a reply) and works the same way whether the AI answers directly or a human ultimately gets involved.

---

## 4. Knowledge Base and Grounded Answers (RAG)

**Status: AVAILABLE NOW**

Every workspace maintains its own private knowledge base. The AI Support Agent uses Retrieval-Augmented Generation (RAG): before generating any reply, it searches the workspace's own knowledge for the passages most relevant to the customer's question, and only those passages are given to the AI as context.

**Supported knowledge sources today:**

- Pasted plain text
- FAQ-formatted content (question/answer pairs, chunked so a question always stays paired with its answer)
- Uploaded PDF documents
- Uploaded DOCX (Word) documents
- Individual web page URLs, submitted one at a time or as a short list — the business specifies which pages to ingest

**Not currently supported for knowledge ingestion:** automatic crawling of an entire website or sitemap. Website knowledge must be added page by page today, not by pointing the agent at a domain and letting it discover pages on its own.

**Grounding guarantee:** the AI Support Agent will not answer from its own general/internet training knowledge. If no sufficiently relevant knowledge is found for a question, the AI is never even asked to answer it — the conversation is escalated instead. If some relevant knowledge exists but is weak, the AI is instructed to say so or decline rather than guess. This is a built-in safeguard, not just an instruction the AI could choose to ignore.

**Knowledge-source prioritization and conflicts:** all of a workspace's knowledge sources are searched together and ranked purely by relevance to the customer's question. There is currently no way to mark one source as higher-priority or more authoritative than another, and no automatic detection or resolution of conflicting information across sources — keeping your knowledge base internally consistent is the business's own responsibility today.

**Confidence scoring:** every AI-generated reply carries an internal confidence assessment, used to decide whether the reply is shown as-is or the conversation is escalated alongside it. A low-confidence reply is not hidden from the customer — if the AI did answer using only the business's own knowledge, that honest answer is shown, and the conversation is still flagged for a human to review.

Knowledge base management (adding, viewing, and removing sources) is available to workspace owners and administrators through the dashboard; searching the knowledge base is available to all authenticated workspace users, including support agents.

---

## 5. Customer and Page Context

**Status: AVAILABLE NOW** (website widget only)

When a customer chats through the website widget, the AI Support Agent is told the current page URL and page title the customer is viewing at the moment they send each message. This is used as **informational context only** — it helps the AI understand what the customer is likely asking about (for example, a question asked from a pricing page vs. a support page) — it is never treated as an instruction or as authoritative business data on its own.

This is currently specific to the website widget channel. As additional channels are introduced in the future, each channel is expected to define its own relevant context signals rather than sharing one generic mechanism.

Customers interacting through the widget are not required to identify themselves. A conversation is anonymous by default; a name and contact method are only captured if the customer chooses to provide them (see Section 6).

**Customer identity:** the AI Support Agent provides anonymous, visitor-level support today. It does not recognize or authenticate a customer who is logged into the business's own website or app, and has no built-in way to automatically pull a specific customer's account, order, or plan details based on being signed in. The only identity information available to it is whatever the customer types into the chat themselves (for example, an email address used for a CRM lookup, or contact details left during escalation).

---

## 6. Human Escalation and Handoff

**Status: AVAILABLE NOW**

The AI Support Agent escalates a conversation to a human whenever:

- No relevant knowledge exists to answer the question.
- The AI's confidence in its own answer is low.
- The AI itself determines a human should be involved (for example, an account-specific or sensitive request).
- An underlying AI provider error occurs.
- The customer explicitly asks to speak with a human (detected directly, without needing an AI call, so a plain "can I talk to a person?" is never accidentally treated as an unanswerable question).

These are currently the fixed, built-in escalation triggers — there is no dashboard control yet for a business to define its own custom escalation rules (for example, always escalating a specific topic or customer segment).

**Contact capture:** when a conversation is escalated, the customer is offered — never forced — the option to leave a name and a way to be reached (email or phone) so a human can follow up even if no agent is watching live. This is only offered once per conversation; a customer who has already provided contact details is not asked again on a later escalation in the same conversation.

**Agent console (dashboard):** human agents work escalated and in-progress conversations from a queue (unassigned, mine, or all), can claim a conversation, and see the full message history over a live connection. Once an agent claims a conversation, the AI stops auto-replying to it entirely — the human is fully in control from that point on.

**AI assistance for agents**, available once a conversation is claimed:
- An AI-generated summary of the conversation, available on request — an agent can pull one up any time instead of reading the full transcript.
- An AI-suggested draft reply the agent can review, edit, and send — the AI never sends a suggested reply on its own; a human always decides.
- Internal notes agents can add to a conversation, visible only to the workspace's own team, never to the customer.

Every claim, reassignment, and status change is recorded on the conversation as a visible, permanent event.

---

## 7. Controlled Integrations and AI Actions

BuildIQ deliberately limits what the AI Support Agent is allowed to do outside of conversation — every action is scoped, logged, and (for now) read-only.

**HubSpot CRM contact lookup — Status: CONFIGURATION/INTEGRATION REQUIRED**

A workspace owner or administrator can connect their own HubSpot account (via a HubSpot Private App access token). Once connected, this integration supports:

- **Agent-triggered lookup** — a human support agent can look up a customer's HubSpot contact record directly from the conversation console, on demand.
- **AI-triggered lookup (opt-in, off by default)** — with a separate toggle a workspace administrator must explicitly enable, the AI itself can check whether a contact record exists for an email address, but only under strict, automatically enforced conditions:
  - The customer must have asked an account-identity-type question (for example, "am I already a customer?").
  - The email address checked must be one the customer themselves typed in the conversation — never an email seen elsewhere, never one the AI invents.
  - The AI can only learn whether a matching record exists (yes/no) — it cannot read back the contact's name, details, or any other CRM data to the customer. Full contact details remain visible only to human agents, through the existing agent-triggered lookup.
  - Lookups are capped per conversation to prevent abuse.

Every lookup — agent-triggered or AI-triggered, successful or not — is written to a permanent audit log.

**Other integrations and vendors are not currently supported.** HubSpot is the only connected integration provider today. The underlying integration architecture is designed to support additional providers, but no second integration is available yet.

**The AI does not write to, update, or take action in any external system today.** Every current capability (agent-triggered and AI-triggered) is strictly read-only. There is no autonomous "AI agent loop" — every AI tool use is a single, bounded, logged step within one conversation turn, not open-ended autonomy.

---

## 8. Analytics and Evaluation

**Status: AVAILABLE NOW** (owners and administrators)

Each workspace has its own analytics dashboard, built entirely from that workspace's own conversation data, with a configurable date range. It includes:

- Conversation volume over time.
- Resolution rate and escalation rate, including a breakdown of *why* conversations were escalated (no relevant knowledge, low confidence, AI-initiated, provider error, or customer-requested).
- AI performance stats: average confidence in AI-generated replies, and overall usage volume.
- The knowledge sources most frequently cited in AI answers, to highlight which content is actually earning its place in the knowledge base.
- Customer satisfaction (CSAT): after a conversation, a customer can optionally rate it with a simple thumbs-up or thumbs-down; the dashboard reports the resulting positive-rating score and a breakdown, based only on conversations that were actually rated.

**Testing before you go live:** the knowledge search tool in the dashboard lets you preview which knowledge passages a specific question would retrieve, so you can sanity-check your content before customers start asking. There is not currently a separate sandbox for simulating full AI conversations, with the AI's actual generated reply, before turning the widget on for real customers.

**Ongoing answer-quality evaluation:** there is no automated regression-testing feature today that tracks or compares AI answer quality across knowledge base changes over time, and no automated "knowledge gap" report. The escalation-reason breakdown and most-cited-sources list above can be used manually to spot where the knowledge base is likely weak.

Analytics access is limited to workspace owners and administrators, matching the same access level as integration and widget-key management. Support agents do not currently see workspace-wide analytics.

---

## 9. Security, Privacy, and Tenant Isolation

BuildIQ is a multi-tenant SaaS platform: many businesses ("workspaces") share the same underlying infrastructure, and BuildIQ is built to keep each workspace's data strictly separated from every other workspace's data.

Key points a prospective customer can rely on:

- **Tenant isolation is enforced at multiple independent layers** — application-level access controls on every request, backed by database-level protections as a second, independent layer — so a bug in any one layer alone can't expose another workspace's data.
- **Passwords are never stored in plain text or in a reversible form** — they are hashed using a modern, industry-standard algorithm designed specifically to resist offline cracking.
- **The widget's public identifier is not a secret credential.** It is designed to live safely in your website's public source code (much like an analytics tag), it can optionally be restricted to only work from your own domain(s), and it can be rotated at any time if you ever want a fresh one.
- **Third-party credentials you provide** (such as a HubSpot access token) are encrypted at rest and are never displayed back to you or logged in plain text once saved.
- **Rate limiting** is applied to authentication, knowledge ingestion, invitations, and chat messages to protect against abuse and runaway usage.
- **Internal agent notes are never exposed to customers**, under any circumstance — this is a core rule of how the system works, not just something hidden in the interface.
- **Conversation and knowledge data sent to our AI model provider** is used only to generate that specific reply, via the provider's standard API — it is not shared with, or visible to, any other BuildIQ workspace.

BuildIQ does not publish exhaustive internal security implementation details (specific algorithms, key management, or infrastructure configuration) in customer-facing materials; the summary above reflects the actual, current architecture at a level appropriate for evaluating the product.

---

## 10. Website Widget Deployment

**Status: AVAILABLE NOW**

The AI Support Agent is deployed to a website as an embeddable chat widget.

- **Installation** is a single script tag added to the website; there is no separate technical "API key setup" step for a business owner to manage — a working install code is generated automatically.
- The widget renders in an isolated part of the page so it doesn't inherit or conflict with the host site's own styles or scripts.
- **Mobile-responsive**: the widget adapts to a full-screen layout on small screens rather than staying a fixed-size floating panel.
- **Automatic reconnection**: if a customer's connection drops (a network blip, a brief server restart), the widget detects it, shows a reconnecting state, and automatically resumes the same conversation once the connection returns — no message history is lost.
- **Appearance customization**, available to workspace owners/administrators without any code changes: assistant name, avatar, greeting message, accent color, and whether the widget sits on the left or right side of the screen.
- **Advanced/developer controls**, kept separate from everyday setup: domain restrictions, install-code rotation, and the raw embed snippet.

Currently, the website chat widget is the **only supported customer-facing channel**. Other channels (see Section 12) are not yet available.

---

## 11. Team and Workspace Management

**Status: AVAILABLE NOW**

Each workspace supports multiple team members under three roles:

- **Owner** — full control of the workspace, including the ability to invite other Owners.
- **Administrator** — configures users, permissions, AI-related settings, integrations, and workspace settings; can invite Administrators and Support Agents, but not Owners.
- **Support Agent** — handles escalated and assigned conversations in the agent console; does not manage integrations, billing-adjacent settings, or workspace-wide analytics.

Team members join a workspace exclusively through an invitation sent by an existing Owner or Administrator; there is no open self-service way for someone to add themselves to an existing workspace.

**Workspace signup itself is currently invite-only** (see Section 12) — BuildIQ is onboarding a limited set of design-partner businesses directly, rather than offering open public self-serve signup.

---

## 12. Current Capabilities Summary

| Capability | Status |
|---|---|
| Website chat widget (install, mobile-responsive, reconnect/backoff) | AVAILABLE NOW |
| Widget appearance customization (name, avatar, greeting, color, position) | AVAILABLE NOW |
| AI-generated, knowledge-grounded conversation replies | AVAILABLE NOW |
| Retrieval-Augmented Generation (RAG) over the workspace's own knowledge | AVAILABLE NOW |
| Knowledge ingestion: pasted text, FAQ, PDF, DOCX, individual web page URLs | AVAILABLE NOW |
| Automatic full-website/sitemap crawling for knowledge ingestion | NOT CURRENTLY SUPPORTED |
| Knowledge-source prioritization / conflict handling across sources | NOT CURRENTLY SUPPORTED |
| Page URL/title as AI context signal (website widget) | AVAILABLE NOW |
| Authenticated / logged-in customer identity recognition | NOT CURRENTLY SUPPORTED |
| Confidence-based and rule-based escalation to a human | AVAILABLE NOW |
| Customer-initiated ("talk to a human") escalation | AVAILABLE NOW |
| Escalation contact capture (name + email/phone, offered once per conversation) | AVAILABLE NOW |
| Customizable escalation rules/policies | NOT CURRENTLY SUPPORTED |
| Live agent console: queue, claim, live message view | AVAILABLE NOW |
| AI conversation summaries and AI-suggested draft replies for agents | AVAILABLE NOW |
| Internal, customer-invisible agent notes | AVAILABLE NOW |
| Customer satisfaction rating (thumbs up/down) | AVAILABLE NOW |
| Analytics dashboard (volume, resolution/escalation rate, AI stats, CSAT, top-cited sources) | AVAILABLE NOW |
| Knowledge base search testing tool (verify what a query retrieves) | AVAILABLE NOW |
| Full pre-launch AI conversation testing/sandbox mode | NOT CURRENTLY SUPPORTED |
| Automated AI answer-quality evaluation / regression testing | NOT CURRENTLY SUPPORTED |
| Automated knowledge-gap reporting | NOT CURRENTLY SUPPORTED |
| Role-based team management (Owner / Administrator / Support Agent) | AVAILABLE NOW |
| Team invitations | AVAILABLE NOW |
| Workspace signup | CONFIGURATION REQUIRED — invite-only design-partner onboarding, not open self-serve |
| HubSpot CRM contact lookup (agent-triggered) | CONFIGURATION/INTEGRATION REQUIRED — requires connecting HubSpot |
| HubSpot CRM contact lookup (AI-triggered, read-only, membership check only) | CONFIGURATION/INTEGRATION REQUIRED — requires HubSpot connected **and** a separate opt-in toggle |
| Additional CRM/commerce/helpdesk integrations beyond HubSpot | PLANNED — vendor/timeline not yet decided |
| AI-initiated write actions (e.g., updating a CRM record, creating a ticket) | NOT CURRENTLY SUPPORTED |
| Integration marketplace | PLANNED |
| Voice support | PLANNED |
| Omnichannel messaging (email, SMS, social, etc.) | PLANNED |
| Multiple specialized AI agents | PLANNED |
| Workflow automation | PLANNED |
| Multi-language support | PLANNED |
| Advanced/expanded analytics | PLANNED |
| Deeper page-content-aware context (beyond URL/title) | PLANNED |
| Self-serve public signup | NOT CURRENTLY SUPPORTED |
| Billing & subscription self-service | NOT CURRENTLY SUPPORTED — currently negotiated directly per design-partner workspace |
| Enterprise SSO | NOT CURRENTLY SUPPORTED |
| Custom AI model training/fine-tuning on a customer's own data | NOT CURRENTLY SUPPORTED |
| Native mobile applications | NOT CURRENTLY SUPPORTED |

---

## 13. Planned / Future Capabilities

The items below reflect BuildIQ's stated product direction. **None of them are available today** — they are listed so prospective customers understand where the product is headed, not what it currently does.

- **Additional integrations** beyond HubSpot — a second read-only integration is planned; the specific vendor and vertical (for example, order-status lookups for commerce-heavy businesses, versus deeper CRM capability) has not been decided, and would be chosen based on real usage data. If built, it is expected to follow the same pattern as HubSpot: narrow, read-only, and AI-usable only under explicit workspace opt-in.
- **Voice support and omnichannel messaging** — extending beyond the website chat widget to additional channels.
- **Workflow automation** and **multiple specialized AI agents** working together on more complex support processes.
- **An integration marketplace** for connecting a broader range of business systems.
- **Advanced analytics**, building on the current dashboard.
- **Multi-language support.**
- **Deeper, channel-specific context awareness** — for the website widget specifically, this would mean richer page-content understanding beyond the current URL/title signal, unified with the existing website-knowledge-ingestion mechanism rather than built as a separate system.
- **Self-serve signup and billing** — the current go-to-market is a small set of invite-only design partners on manually agreed terms; open self-serve signup and subscription billing are future work, not scoped for the current release.
- **Enterprise features** such as SSO, aimed at larger organizations as a future customer segment.

---

## 14. Frequently Asked Questions

**What is BuildIQ's AI Support Agent?**
An AI-powered first line of customer support, embedded as a chat widget on a business's website. It answers customer questions using that business's own knowledge base, escalates to a human when it can't answer confidently, and gives human agents AI-assisted tools (summaries, suggested replies) for everything it hands off.

**Will the AI make things up or answer from general knowledge instead of my business's own information?**
No. The AI only answers using knowledge retrieved from your own workspace's knowledge base. If nothing relevant is found for a question, the AI is not even asked to answer it — the conversation is escalated to a human instead, rather than guessing.

**What happens if the AI doesn't know the answer?**
The conversation is escalated. Depending on the reason, the AI may still provide an honest, grounded partial answer alongside the escalation, or a fallback message may be shown if no answer was possible at all. Either way, the customer can optionally leave contact details so a human can follow up.

**Can a real person take over a conversation?**
Yes. A human support agent can claim any conversation from the agent console at any time. Once claimed, the AI stops generating further replies for that conversation — the agent is fully in control, with an AI-generated summary (available on request) and AI-suggested reply drafts to help them respond quickly.

**Does the AI ever hide anything from my team, or hide anything from my customers?**
Internal notes agents leave on a conversation are only ever visible to your team, never to the customer. Conversely, nothing from your internal notes or backend integration activity is ever shown to the customer.

**What CRM or business tools does it integrate with?**
HubSpot is the only supported integration today, offering read-only contact lookup — either triggered manually by a human agent, or (only if you explicitly opt in) triggered by the AI itself for a narrow class of account-identity questions, disclosing only whether a matching record exists, never the record's contents. Additional integrations are planned but not yet available.

**Can the AI take actions in my other systems, like updating a record or creating a ticket?**
Not currently. Every AI-invoked action today is read-only and tightly scoped — the AI can check information (like whether a CRM contact exists) but cannot create, update, or delete anything in your other systems.

**Is my data isolated from other businesses using BuildIQ?**
Yes. BuildIQ is a multi-tenant platform where each business's data is kept in its own workspace, enforced by two independent layers of access control. One workspace cannot see or query another workspace's conversations, knowledge, or settings.

**Is my customer conversation data used to train BuildIQ's AI model, or shared with other customers?**
No. Your data is not shared with or visible to other BuildIQ workspaces. Conversation content is sent to our AI model provider only to generate that specific reply, through the provider's standard API — it is not pooled with, or used to improve answers for, any other BuildIQ workspace.

**How do I add my business's knowledge to the AI?**
Through the dashboard: paste text or FAQs directly, upload PDF or DOCX files, or submit individual web page URLs. There is currently no automatic full-site crawl — pages are added individually or in a short list.

**Can customers chat with the AI without giving their name or email?**
Yes. Conversations are anonymous by default. A name and contact method are only requested (and always optional) if a conversation is escalated and the customer chooses to leave their details.

**What channels does the AI Support Agent support?**
Currently, the website chat widget only. Additional channels (voice, email, SMS, social messaging) are planned but not available yet.

**Can I customize how the widget looks?**
Yes — assistant name, avatar, greeting message, accent color, and left/right position are all configurable without writing code. Deeper behavioral customization comes from what you put in your knowledge base.

**How is BuildIQ's AI Support Agent different from Intercom Fin?**
Both are AI agents designed to resolve support conversations using a business's own knowledge and hand off to a human when needed. As of today, BuildIQ is the earlier-stage, more narrowly-scoped product in several concrete ways: it connects to one external system (HubSpot, read-only) rather than a broad, configurable library of integrations; it does not yet recognize or authenticate a customer who is logged into your own site or app, so it can't yet personalize answers using that customer's real account data; it has no dashboard control for prioritizing one knowledge source over another when sources disagree, or for defining your own custom escalation rules beyond the built-in ones; and it does not yet offer a dedicated pre-launch testing sandbox or ongoing answer-quality evaluation tooling. Where BuildIQ holds its own today is tenant data isolation and how tightly every AI action is scoped, logged, and reviewable. Businesses evaluating both should weigh BuildIQ's narrower-but-controlled current scope against a more established competing product's broader existing feature set.

**Can I sign up for BuildIQ myself right now?**
Not through open self-serve signup at this time. BuildIQ is currently onboarding a limited number of design-partner businesses directly; reach out through your BuildIQ contact to get started.

**Is there a billing/subscription plan I can choose today?**
Not a self-serve one. Pricing and terms are currently negotiated directly per design-partner workspace; self-serve subscription billing is planned but not yet available.

**Does BuildIQ support multiple languages?**
Not as a dedicated, guaranteed feature today. Multi-language support is on the roadmap.

**Can I test the AI before turning it on for real customers?**
You can preview which knowledge passages a specific question would retrieve, using the search tool in the dashboard. There is not currently a separate sandbox for running full simulated conversations, with the AI's actual generated replies, before it's live for customers.

**Does the AI recognize returning or logged-in customers?**
Not automatically. Conversations are anonymous by default, and the AI does not currently authenticate or automatically pull account data for a customer who is signed into your website or app. If HubSpot is connected, it can check whether a CRM record exists for an email the customer types into the chat, but this is a one-off, in-conversation check, not persistent identity recognition.

**What happens if two of my knowledge sources contradict each other?**
The AI retrieves whichever passages are most relevant to the question across all your sources — there's currently no way to mark one source as higher-priority than another, so conflicting content across sources can produce inconsistent answers. Keeping your knowledge base internally consistent is your responsibility today.

**Is there a limit to how much knowledge I can upload, or how it performs at scale?**
The platform applies reasonable technical bounds (for example, per-file and per-request size limits) to keep ingestion reliable, but these are implementation safeguards rather than customer-facing plan limits. For sizing questions specific to your use case, check with your BuildIQ contact.
