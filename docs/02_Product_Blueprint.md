# 02_Product_Blueprint.md

# Product Blueprint

## Product Summary

An AI-powered Customer Support Platform that acts as an intelligent support teammate. The platform learns about a business, communicates naturally with customers, performs approved actions, collaborates with human agents, and continuously improves through analytics and feedback.

---

# Product Principles

Every feature must follow these principles:

- AI first, human supported.
- Fast and simple to deploy.
- Modular and extensible.
- Workspace-based architecture with complete tenant isolation..
- Secure by default.
- Channel agnostic.
- Business focused, not technology focused.

**Channel agnostic, refined:** the AI core (Learn/Understand/Answer/Act/Collaborate/Improve) is channel-agnostic - it doesn't matter whether a conversation arrives via the website widget, a future messaging channel, or a future voice channel. The *context* each channel supplies to that core is not agnostic, and must never be designed as if one channel's signals apply universally. Each channel defines its own context - see "Platform Interfaces" and capability 2 ("Understand") below.

**Business focused, not technology focused, refined (agreed direction, widget UX):** a workspace owner configures their AI assistant's identity and behavior - name, avatar, greeting, appearance, where it's installed - never raw technical mechanics (credentials, domain allowlists, embed internals). Those remain real, and remain necessary, but live under an Advanced/Developer area, not the primary workflow. The owner's mental model should be "install and customize my AI support assistant," never "configure an API integration."

---

# Core Capabilities

## 1. Learn

The platform continuously builds knowledge about the business.

Responsibilities:
- Import company knowledge
- Organize information
- Index content for semantic search
- Keep knowledge up to date

Knowledge Sources:
- Website
- PDFs
- DOCX
- FAQs
- Plain text
- Future external sources

---

## 2. Understand

The AI understands every conversation before responding.

Responsibilities:
- Detect intent
- Maintain conversation memory
- Understand context
- Identify customer sentiment
- Measure confidence

"Understand context" includes **channel-specific context signals**, not a universal, channel-independent input. The website widget's first such signal is the visitor's current page URL and page title - not full page content, not cross-page navigation history, and not assumed to be how any other channel supplies context. A future channel defines its own context signals; nothing here should be generalized into a single cross-channel context model without a deliberate reason to.

---

## 3. Answer

Generate accurate, helpful, and natural responses.

Responsibilities:
- Retrieve relevant knowledge
- Generate responses
- Cite supporting information (where appropriate)
- Stream replies in real time

---

## 4. Act

The AI performs approved business actions.

Examples:
- Check an order
- Create a ticket
- Schedule an appointment
- Update customer information
- Process supported workflows

Every action must be secure, auditable, and permission-controlled.

---

## 5. Collaborate

AI and humans work together.

Responsibilities:
- Human handoff
- Live takeover
- AI-generated conversation summaries
- Suggested replies
- Shared conversation history

The AI assists human agents instead of disappearing.

---

## 6. Improve

The platform continuously learns from usage.

Responsibilities:
- Conversation analytics
- Resolution metrics
- Knowledge gap detection
- Frequently asked questions
- AI performance insights
- Business recommendations

---

# Platform Interfaces

Customers interact through channels such as:
- Website
- Future messaging platforms
- Future voice channels

Each channel is responsible for defining and supplying its own context to the AI core - see capability 2 ("Understand"). The website channel and any future channel are not assumed to share a context model.

Businesses manage the platform through:
- Dashboard
- Analytics
- Knowledge management
- User management
- Settings

Integrations extend the platform through:
- CRM
- E-commerce
- Helpdesk
- Payments
- Custom APIs

---

# Product Vision

We are not building a chatbot.

We are building an AI Support Platform that can learn, understand, answer, act, collaborate, and improve.

Every current and future feature must strengthen one or more of these six capabilities.