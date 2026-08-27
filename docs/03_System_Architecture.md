# 03_System_Architecture.md

# System Architecture

**Version:** 1.1  
**Status:** ✅ Approved

**Note:** this document describes the approved *conceptual* architecture — components and their responsibilities. For which parts of it are actually implemented versus formally decided-but-not-yet-built for production (hosting, scaling, CI/CD, domains, realtime/job-queue evolution), see [`08_Production_Architecture.md`](./08_Production_Architecture.md). Current V1/V2 scope decisions (e.g., Billing — listed below as a component but deferred to V2) are tracked in [`00_Product_Requirement_Specification.md`](./00_Product_Requirement_Specification.md) and [`09_Fin_Benchmark_And_Product_Roadmap.md`](./09_Fin_Benchmark_And_Product_Roadmap.md), not here — this document's component list is the long-run conceptual shape, not a V1 commitment.

---

# Architecture Principles

- AI is a service, not the system.
- The Support Orchestrator owns all business logic.
- Every capability is implemented as an independent logical service.
- Services remain loosely coupled.
- The platform is channel-agnostic.
- The platform is integration-ready.
- Multi-tenant by design (Workspace-based).
- Security is enforced at every layer.
- Business logic lives in the application, not inside the LLM.

---

# High-Level Architecture

```text
                    Customer
                        │
                        ▼
             Communication Channels
      (Website • WhatsApp • Email • Voice)
                        │
                        ▼
            Workspace Identification
                        │
                        ▼
             ┌─────────────────────┐
             │ Support Orchestrator │
             └─────────────────────┘
                        │
      ┌──────────┬──────────┬──────────┬──────────┬──────────┐
      ▼          ▼          ▼          ▼          ▼
 Memory      Knowledge      AI    Integration   Agent
 Service      Service     Service    Service    Console
                        │
                        ▼
               Analytics Service
                        │
                        ▼
               Platform Data Layer
                        │
                        ▼
                  Admin Console
```

---

# Platform Components

## Communication Channels

Entry point for all customer interactions.

Supported Channels:

- Website Chat Widget

Future Channels:

- WhatsApp
- Messenger
- Instagram
- Telegram
- Email
- Voice

All communication channels should behave consistently and connect to the same platform.

---

## Workspace Identification

Every incoming request must first identify its workspace before any processing begins.

Responsibilities:

- Identify the workspace
- Validate API key or authentication token
- Load workspace configuration
- Load branding settings
- Load enabled integrations
- Load AI configuration
- Pass workspace context to the orchestrator

**Note**

"Workspace" is the customer-facing term.

"Tenant" is the internal technical concept used for data isolation.

---

## Support Orchestrator

The central coordinator of the platform.

Responsibilities:

- Receive customer requests
- Coordinate platform services
- Maintain conversation state
- Enforce business rules
- Decide workflow execution
- Route requests between services
- Handle failures
- Trigger human handoff
- Log platform events

The Support Orchestrator contains business logic, not AI logic.

---

## Memory Service

Maintains conversation context.

Responsibilities:

- Session memory
- Conversation history
- Long-term memory
- Context retrieval

The Memory Service provides context but never generates responses.

---

## Knowledge Service

Manages business knowledge.

Responsibilities:

- Document ingestion
- Website crawling
- Knowledge indexing
- Semantic search
- Knowledge retrieval

**Note**

RAG is implemented within this service and is considered an implementation detail rather than a platform component.

---

## AI Service

Provides intelligence to the platform.

Responsibilities:

- Intent understanding
- Response generation
- Structured outputs
- Tool selection
- Confidence scoring

The AI Service never owns business logic or customer data.

It only processes the context provided by the Support Orchestrator.

---

## Integration Service

Provides a unified interface for external systems.

Responsibilities:

- Execute business actions
- Connect external APIs
- Normalize different integrations
- Handle authentication
- Return standardized responses

Examples:

- CRM
- E-commerce
- Helpdesk
- Payment systems
- Booking systems
- Custom APIs

The Support Orchestrator interacts only with the Integration Service and never communicates directly with third-party systems.

---

## Agent Console

Workspace for human support agents.

Responsibilities:

- Human takeover
- Live conversations
- Conversation history
- AI-generated summaries
- Suggested replies
- Internal notes

The AI continues assisting the human agent after handoff.

---

## Analytics Service

Transforms conversations into business insights.

Examples:

- AI resolution rate
- Human escalation rate
- Frequently asked questions
- Knowledge gaps
- AI confidence metrics
- Customer satisfaction
- Usage statistics

---

## Platform Data Layer

Stores platform data while ensuring complete isolation between workspaces.

Components:

- PostgreSQL
- Vector Database (pgvector)
- Redis Cache
- Object Storage

Stores:

- Workspaces (Tenants)
- Users
- Conversations
- Messages
- Knowledge
- Integrations
- Analytics
- Billing
- Audit Logs

---

## Admin Console

Business control center.

Responsibilities:

- Workspace settings
- Branding
- Knowledge management
- User management
- Analytics
- Billing
- Plugin management
- AI configuration
- Integration management

---

# Request Lifecycle

```text
Customer Message
        │
        ▼
Communication Channel
        │
        ▼
Workspace Identification
        │
        ▼
Support Orchestrator
        │
        ├── Load Memory
        ├── Retrieve Knowledge
        ├── Determine Required Actions
        ├── Call AI Service
        ├── Execute Integrations (if required)
        ├── Evaluate Confidence
        ├── Escalate to Human (if required)
        ├── Save Conversation
        ├── Update Analytics
        └── Return Response
        │
        ▼
Customer
```

---

# Scalability Philosophy

The platform is designed as a modular monolith.

Every capability is implemented as an independent logical service.

As the platform grows, services can be extracted into separate microservices without changing the overall architecture.

Examples:

- AI Service
- Knowledge Service
- Integration Service
- Analytics Service

This minimizes future refactoring while supporting long-term scalability.

---

# Future Expansion

New functionality should extend existing services instead of modifying the Support Orchestrator.

Examples:

- New communication channels
- New AI providers
- New integrations
- New analytics
- New business actions

The Support Orchestrator remains the single coordinator of all platform activity.

---

# Architectural Philosophy

The platform is built around orchestration rather than AI.

The AI is one service within the platform—not the platform itself.

This separation ensures:

- AI models can be replaced without affecting business logic.
- New integrations can be added without changing workflows.
- New communication channels reuse existing capabilities.
- Business rules remain deterministic and testable.
- The platform evolves independently of any specific AI provider.