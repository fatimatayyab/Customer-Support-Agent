# 04_Domain_Model.md

# Domain Model

**Version:** 1.0  
**Status:** ✅ Approved

---

## Workspace

Represents a business using the platform and acts as the ownership boundary for all business resources.

Owns:

- Users
- Customers
- Conversations
- Knowledge Sources
- Integrations
- AI Configuration
- Analytics
- Billing

---

## User

Represents a member of a Workspace.

Roles:

- Owner
- Administrator
- Support Agent

Relationships:

- Belongs to one Workspace
- May manage multiple Conversations

---

## Customer

Represents a person requesting support from the business.

Relationships:

- Belongs to one Workspace
- Can have multiple Conversations

---

## Conversation

Represents a customer support session.

Relationships:

- Belongs to one Workspace
- Belongs to one Customer
- Contains multiple Messages
- May be assigned to one Support Agent

Lifecycle:

- Open
- Waiting for Customer
- Escalated
- Assigned
- Resolved
- Closed

---

## Message

Represents a single communication within a Conversation.

Types:

- Customer
- AI
- Human Agent
- System

Relationships:

- Belongs to one Conversation

---

## Knowledge Source

Represents business knowledge available to the AI.

Supported Sources:

- Website
- PDF
- DOCX
- FAQ
- Plain Text

Relationships:

- Belongs to one Workspace
- Produces multiple Knowledge Chunks

---

## Knowledge Chunk

Represents a searchable portion of a Knowledge Source used during Retrieval-Augmented Generation (RAG).

Relationships:

- Belongs to one Knowledge Source

---

## Integration

Represents an external business system connected to the platform.

Examples:

- Shopify
- HubSpot
- Stripe
- Custom API

Relationships:

- Belongs to one Workspace

Purpose:

- Retrieve business data
- Execute approved business actions

---

## AI Configuration

Represents the AI behavior configured for a Workspace.

Controls:

- AI Model
- Prompt Templates
- Enabled Capabilities
- Escalation Rules

Relationships:

- Belongs to one Workspace

---

## Analytics

Represents business insights generated from customer support activity.

Examples:

- Resolution Rate
- Escalation Rate
- Customer Satisfaction
- AI Usage
- Popular Topics
- Knowledge Gaps

Relationships:

- Belongs to one Workspace

---

## Billing

Represents the commercial relationship between the Workspace and the platform.

Includes:

- Subscription
- Usage
- Limits
- Invoices

Relationships:

- Belongs to one Workspace

---

# Domain Relationships

```text
Workspace
│
├── Users
├── Customers
│      └── Conversations
│              └── Messages
├── Knowledge Sources
│      └── Knowledge Chunks
├── Integrations
├── AI Configuration
├── Analytics
└── Billing
```