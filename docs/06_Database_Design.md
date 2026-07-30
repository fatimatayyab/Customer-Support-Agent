# 06_Database_Design.md

# Database Design

**Version:** 1.0  
**Status:** ✅ Approved

---

# Purpose

This document defines how business data is persisted within the AI Customer Support Platform.

The schema is designed to support scalability, Workspace isolation, auditability, and future expansion while remaining independent of business logic.

---

# Design Principles

- Single database shared by all Workspaces.
- Complete Workspace isolation.
- Normalize relational data where appropriate.
- Separate relational, vector, cache, and object storage.
- Every business record belongs to one Workspace.
- Every important action is auditable.
- Design for future scalability.

---

# Persistent Entities

## Workspace

Stores:

- Workspace Settings
- Branding
- AI Configuration
- Subscription
- Billing Information

Owns:

- Users
- Customers
- Conversations
- Knowledge
- Integrations
- Analytics

---

## User

Stores:

- Profile Information
- Authentication
- Roles
- Account Status

---

## Customer

Stores:

- Name
- Email
- Phone Number
- External Identifiers
- Customer Tags

Relationships:

- Belongs to one Workspace
- Can have multiple Conversations

---

## Conversation

Stores:

- Status
- Source Channel
- Assigned Support Agent
- Priority
- Labels
- AI Summary
- Resolution
- Created / Updated Timestamps

Relationships:

- Belongs to one Workspace
- Belongs to one Customer
- Contains multiple Messages

---

## Message

Stores:

- Sender Type
- Message Content
- Timestamp
- Attachments
- AI Metadata (when applicable)

Types:

- Customer
- AI
- Human Agent
- System

---

## Knowledge Source

Stores:

- Source Type
- Source Location
- Processing Status
- Metadata

Supported Sources:

- Website
- PDF
- DOCX
- FAQ
- Plain Text

---

## Knowledge Chunk

Stores:

- Chunk Content
- Embedding
- Chunk Order
- Metadata

Used during semantic search and Retrieval-Augmented Generation (RAG).

---

## Integration

Stores:

- Provider
- Authentication
- Configuration
- Available Actions
- Connection Status

Examples:

- Shopify
- HubSpot
- Stripe
- Custom API

---

## AI Configuration

Stores:

- Default Model
- Prompt Templates
- Temperature
- Enabled Capabilities
- Escalation Rules
- Allowed Business Actions
- Confidence Threshold

---

## Analytics

Stores:

- Total Conversations
- Resolution Rate
- Escalation Rate
- Response Time
- Customer Satisfaction
- AI Usage
- Popular Topics
- Knowledge Gaps

---

## Billing

Stores:

- Subscription Plan
- Usage
- Limits
- Invoices
- Payment Status

---

## Audit Log

Stores platform events for auditing and troubleshooting.

Examples:

- User Login
- Knowledge Upload
- Integration Changes
- Permission Changes
- AI Configuration Changes
- Billing Events

---

# Entity Relationships

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
├── Billing
└── Audit Logs
```

---

# Data Ownership

Every business record belongs to exactly one Workspace.

Workspace ownership applies to:

- Users
- Customers
- Conversations
- Messages
- Knowledge Sources
- Knowledge Chunks
- Integrations
- Analytics
- Billing
- Audit Logs

Workspace isolation is enforced throughout the platform.

---

# Storage Strategy

## Relational Database

Stores structured business data.

Examples:

- Workspaces
- Users
- Customers
- Conversations
- Messages
- Integrations
- Billing
- Analytics

---

## Vector Storage

Stores semantic search data.

Examples:

- Knowledge Chunks
- Embeddings

---

## Cache

Stores temporary, high-speed data.

Examples:

- User Sessions
- Frequently Accessed Data
- AI Context Cache

---

## Object Storage

Stores uploaded files.

Examples:

- PDFs
- Images
- Attachments
- Knowledge Documents

---

# Future Expansion

The schema should support future capabilities without major redesign.

Examples:

- Additional communication channels
- Voice conversations
- Multiple AI providers
- Workflow automation
- Marketplace integrations
- Enterprise features