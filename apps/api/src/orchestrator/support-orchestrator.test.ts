import { randomUUID } from "node:crypto";
import { integrationActionLogs, withWorkspaceContext } from "@csa/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../errors.js";
import { getConversationById } from "../modules/conversations/conversation.repository.js";
import { listConversationNotes } from "../modules/conversations/conversation-note.repository.js";
import { listMessages } from "../modules/conversations/message.repository.js";
import { PROVIDER_ERROR_MESSAGE } from "../modules/ai/prompts/fallback-messages.js";
import { encryptCredentials } from "../modules/integrations/credential-crypto.js";
import { upsertIntegration } from "../modules/integrations/integration.repository.js";
import { insertKnowledgeChunks } from "../modules/knowledge/knowledge-chunk.repository.js";
import { insertKnowledgeSource } from "../modules/knowledge/knowledge-source.repository.js";
import { SynchronousJobRunner } from "../job-runner.js";
import { FakeAiProvider } from "../test-support/fake-ai-provider.js";
import { FakeEmbeddingProvider } from "../test-support/fake-embedding-provider.js";
import { FakeIntegrationProvider, fakeIntegrationProviderFactory } from "../test-support/fake-integration-provider.js";
import { createConversation, createCustomer, createUser, createWorkspace } from "../test-support/fixtures.js";
import { resetDatabase } from "../test-support/reset-database.js";
import {
  addInternalNote,
  changeConversationStatus,
  claimConversation,
  handleCustomerMessage,
  initiateConversation,
  lookupContact,
  sendAgentMessage,
  suggestReplyForAgent,
  summarizeConversationForAgent,
  type OrchestratorDeps,
} from "./support-orchestrator.js";

// A relevant knowledge chunk, embedded with the SAME FakeEmbeddingProvider
// a test's deps use for the query - since the fake returns an identical
// vector for every document and every query, this always scores 1.0
// cosine similarity, clearing MIN_RELEVANCE_SIMILARITY trivially. A
// "no relevant knowledge" case needs no special vector math - it's
// covered by simply not calling this at all for that workspace.
async function seedRelevantKnowledge(workspaceId: string, embeddingProvider: FakeEmbeddingProvider) {
  return withWorkspaceContext(workspaceId, async (scopedDb) => {
    const content = "Our refund policy: full refunds within 30 days of purchase.";
    const source = await insertKnowledgeSource(scopedDb, { workspaceId, type: "plain_text", title: "Refunds", content });
    const [embedding] = await embeddingProvider.embedDocuments([content]);
    await insertKnowledgeChunks(scopedDb, [
      { workspaceId, knowledgeSourceId: source.id, content, embedding: embedding!, chunkOrder: 0 },
    ]);
    return source;
  });
}

function messageContents(messages: Awaited<ReturnType<typeof listMessages>>) {
  return messages.map((message) => ({ senderType: message.senderType, content: message.content }));
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

describe("initiateConversation", () => {
  it("starts a brand-new conversation for a first-time visitor", async () => {
    const workspace = await createWorkspace();

    const result = await initiateConversation({ workspaceId: workspace.id });

    expect(result.messages).toHaveLength(0);
    expect(result.conversation.customerId).toBe(result.customer.id);
  });

  it("resumes an existing conversation by id, including its history", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);
    // Claimed first so handleCustomerMessage's AI branch is skipped
    // entirely (see the dedicated "never calls the AI once claimed"
    // test below) - this test is about history resumption, not AI
    // behavior, so it deliberately avoids depending on that path at all.
    await claimConversation(workspace.id, conversation.id, agent.id);
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "hello" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() },
    );

    const result = await initiateConversation({ workspaceId: workspace.id, conversationId: conversation.id });

    expect(result.conversation.id).toBe(conversation.id);
    // One customer message plus the claim's own system audit message.
    expect(result.messages).toHaveLength(2);
  });

  it("falls through to a fresh conversation on a stale/invalid conversationId", async () => {
    const workspace = await createWorkspace();

    const result = await initiateConversation({ workspaceId: workspace.id, conversationId: randomUUID() });

    expect(result.messages).toHaveLength(0);
  });

  it("trusts a resumed conversation's real customer over a separately-supplied customerId", async () => {
    const workspace = await createWorkspace();
    const realCustomer = await createCustomer(workspace.id);
    const conversation = await createConversation(workspace.id, realCustomer.id);
    const otherCustomer = await createCustomer(workspace.id);

    const result = await initiateConversation({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      customerId: otherCustomer.id,
    });

    expect(result.customer.id).toBe(realCustomer.id);
  });
});

describe("handleCustomerMessage", () => {
  it("persists and makes the customer message readable regardless of AI outcome", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "Where's my order?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() },
    );

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messageContents(messages)).toContainEqual({ senderType: "customer", content: "Where's my order?" });
  });

  it("never calls the AI once a human has claimed the conversation", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);
    await claimConversation(workspace.id, conversation.id, agent.id);

    // Deliberately unconfigured - FakeAiProvider throws if ever actually
    // invoked, so this doubles as proof the AI path is structurally
    // unreachable here, not just "happened not to run this time."
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "still there?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() },
    );

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messages.some((message) => message.senderType === "ai")).toBe(false);
  });

  it("escalates with no_relevant_knowledge and never calls the AI when nothing clears the relevance floor", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "anything?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider(), embeddingProvider: new FakeEmbeddingProvider() },
    );

    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    const metadata = conversationAfter?.metadata as { escalation?: { reason: string } } | null;
    expect(conversationAfter?.status).toBe("escalated");
    expect(metadata?.escalation?.reason).toBe("no_relevant_knowledge");

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messages.some((message) => message.senderType === "ai")).toBe(false);
    expect(messages.some((message) => message.senderType === "system")).toBe(true);
  });

  it("replies and does not escalate when the AI is confident and grounded", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const embeddingProvider = new FakeEmbeddingProvider();
    await seedRelevantKnowledge(workspace.id, embeddingProvider);
    const aiProvider = new FakeAiProvider().mockReply({ reply: "You get a full refund within 30 days.", confidence: 0.95 });

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "Can I get a refund?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider, embeddingProvider },
    );

    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    expect(conversationAfter?.status).not.toBe("escalated");

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messageContents(messages)).toContainEqual({
      senderType: "ai",
      content: "You get a full refund within 30 days.",
    });
  });

  it("still shows a low-confidence reply to the customer, but escalates it", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const embeddingProvider = new FakeEmbeddingProvider();
    await seedRelevantKnowledge(workspace.id, embeddingProvider);
    const aiProvider = new FakeAiProvider().mockReply({ reply: "Maybe within 30 days?", confidence: 0.2 });

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "Can I get a refund?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider, embeddingProvider },
    );

    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    const metadata = conversationAfter?.metadata as { escalation?: { reason: string } } | null;
    expect(conversationAfter?.status).toBe("escalated");
    expect(metadata?.escalation?.reason).toBe("low_confidence");

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messageContents(messages)).toContainEqual({ senderType: "ai", content: "Maybe within 30 days?" });
  });

  it("escalates as ai_requested_escalation when the model asks for a human, regardless of confidence", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const embeddingProvider = new FakeEmbeddingProvider();
    await seedRelevantKnowledge(workspace.id, embeddingProvider);
    const aiProvider = new FakeAiProvider().mockReply({ confidence: 0.95, needsEscalation: true });

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "Can I get a refund?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider, embeddingProvider },
    );

    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    const metadata = conversationAfter?.metadata as { escalation?: { reason: string } } | null;
    expect(metadata?.escalation?.reason).toBe("ai_requested_escalation");
  });

  it("escalates as ai_provider_error and sends the fixed fallback message when the provider throws", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const embeddingProvider = new FakeEmbeddingProvider();
    await seedRelevantKnowledge(workspace.id, embeddingProvider);
    const aiProvider = new FakeAiProvider().mockReplyError(new Error("provider is down"));

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "Can I get a refund?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider, embeddingProvider },
    );

    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    const metadata = conversationAfter?.metadata as { escalation?: { reason: string } } | null;
    expect(metadata?.escalation?.reason).toBe("ai_provider_error");

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messageContents(messages)).toContainEqual({ senderType: "system", content: PROVIDER_ERROR_MESSAGE });
  });
});

describe("claimConversation", () => {
  it("assigns the conversation and posts a system audit message", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id, { name: "Sarah" });
    const conversation = await createConversation(workspace.id);

    await claimConversation(workspace.id, conversation.id, agent.id);

    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    expect(conversationAfter?.assignedUserId).toBe(agent.id);

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messageContents(messages)).toContainEqual({
      senderType: "system",
      content: "Sarah claimed this conversation.",
    });
  });

  it("announces a reassignment from one agent to another", async () => {
    const workspace = await createWorkspace();
    const first = await createUser(workspace.id, { name: "Alex" });
    const second = await createUser(workspace.id, { name: "Sarah" });
    const conversation = await createConversation(workspace.id);
    await claimConversation(workspace.id, conversation.id, first.id);

    await claimConversation(workspace.id, conversation.id, second.id);

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messageContents(messages)).toContainEqual({
      senderType: "system",
      content: "Reassigned from Alex to Sarah.",
    });
  });

  it("re-claiming by the same user is a silent no-op", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);
    await claimConversation(workspace.id, conversation.id, agent.id);

    await claimConversation(workspace.id, conversation.id, agent.id);

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messages.filter((message) => message.senderType === "system")).toHaveLength(1);
  });
});

describe("changeConversationStatus", () => {
  it("updates the status field", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    await changeConversationStatus(workspace.id, conversation.id, "resolved");

    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    expect(conversationAfter?.status).toBe("resolved");
  });
});

describe("sendAgentMessage", () => {
  it("persists and broadcasts an agent-authored message with the sender attributed", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);

    const message = await sendAgentMessage(workspace.id, conversation.id, agent.id, "We'll look into it.");

    expect(message.senderType).toBe("agent");
    expect(message.senderUserId).toBe(agent.id);
  });
});

describe("addInternalNote", () => {
  it("is readable as a note but never appears in the customer-facing message list", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);

    await addInternalNote(workspace.id, conversation.id, agent.id, "Customer sounds frustrated.");

    const notes = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listConversationNotes(scopedDb, workspace.id, conversation.id),
    );
    expect(notes.map((note) => note.content)).toContain("Customer sounds frustrated.");

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messages.some((message) => message.content === "Customer sounds frustrated.")).toBe(false);
  });
});

describe("suggestReplyForAgent", () => {
  it("returns null when there's no customer message to respond to yet", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    const suggestion = await suggestReplyForAgent(workspace.id, conversation.id, {
      aiProvider: new FakeAiProvider(),
    });

    expect(suggestion).toBeNull();
  });

  it("returns null under the same grounding floor as the customer-facing path", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "hello?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider(), embeddingProvider: new FakeEmbeddingProvider() },
    );

    const suggestion = await suggestReplyForAgent(workspace.id, conversation.id, {
      aiProvider: new FakeAiProvider(),
      embeddingProvider: new FakeEmbeddingProvider(),
    });

    expect(suggestion).toBeNull();
  });

  it("returns a draft without ever persisting it", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const embeddingProvider = new FakeEmbeddingProvider();
    await seedRelevantKnowledge(workspace.id, embeddingProvider);
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "Can I get a refund?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider(), embeddingProvider },
    );
    const messagesBefore = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );

    const aiProvider = new FakeAiProvider().mockReply({ reply: "Draft: yes, within 30 days." });
    const suggestion = await suggestReplyForAgent(workspace.id, conversation.id, { aiProvider, embeddingProvider });

    expect(suggestion?.reply).toBe("Draft: yes, within 30 days.");
    const messagesAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messagesAfter).toHaveLength(messagesBefore.length);
  });
});

describe("summarizeConversationForAgent", () => {
  it("returns the summary and persists it onto the conversation's metadata", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "hi" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider(), embeddingProvider: new FakeEmbeddingProvider() },
    );
    const aiProvider = new FakeAiProvider().mockSummarize({ summary: "Customer asked a question, unresolved." });

    const result = await summarizeConversationForAgent(workspace.id, conversation.id, { aiProvider });

    expect(result.summary).toBe("Customer asked a question, unresolved.");
    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    const metadata = conversationAfter?.metadata as { aiSummary?: { text: string } } | null;
    expect(metadata?.aiSummary?.text).toBe("Customer asked a question, unresolved.");
  });
});

describe("lookupContact", () => {
  async function connectFakeIntegration(workspaceId: string) {
    const credentials = await encryptCredentials({ accessToken: "fake-token" });
    return withWorkspaceContext(workspaceId, (scopedDb) =>
      upsertIntegration(scopedDb, { workspaceId, provider: "hubspot", credentials, config: {} }),
    );
  }

  it("logs a success and writes an agent-only note when a contact is found", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);
    await connectFakeIntegration(workspace.id);
    const fakeProvider = new FakeIntegrationProvider().mockFound({ name: "Jane Doe" });

    const result = await lookupContact(workspace.id, conversation.id, agent.id, "jane@example.test", {
      integrationProviderFactory: fakeIntegrationProviderFactory(fakeProvider),
    });

    expect(result.found).toBe(true);

    const notes = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listConversationNotes(scopedDb, workspace.id, conversation.id),
    );
    expect(notes.some((note) => note.content.includes("Jane Doe"))).toBe(true);

    const logs = await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.select().from(integrationActionLogs).where(eq(integrationActionLogs.workspaceId, workspace.id)),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]?.resultStatus).toBe("success");
  });

  it("logs success but writes no note when the lookup succeeds without finding anyone", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);
    await connectFakeIntegration(workspace.id);
    const fakeProvider = new FakeIntegrationProvider().mockNotFound("ghost@example.test");

    const result = await lookupContact(workspace.id, conversation.id, agent.id, "ghost@example.test", {
      integrationProviderFactory: fakeIntegrationProviderFactory(fakeProvider),
    });

    expect(result.found).toBe(false);
    const notes = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listConversationNotes(scopedDb, workspace.id, conversation.id),
    );
    expect(notes).toHaveLength(0);
  });

  it("still logs a failure entry even though the call throws", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);
    await connectFakeIntegration(workspace.id);
    const fakeProvider = new FakeIntegrationProvider().mockError(new Error("HubSpot is down"));

    await expect(
      lookupContact(workspace.id, conversation.id, agent.id, "jane@example.test", {
        integrationProviderFactory: fakeIntegrationProviderFactory(fakeProvider),
      }),
    ).rejects.toThrow();

    const logs = await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.select().from(integrationActionLogs).where(eq(integrationActionLogs.workspaceId, workspace.id)),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]?.resultStatus).toBe("failure");
  });

  it("rejects with no log entry when no integration is connected at all", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);

    await expect(lookupContact(workspace.id, conversation.id, agent.id, "jane@example.test")).rejects.toThrow();

    const logs = await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.select().from(integrationActionLogs).where(eq(integrationActionLogs.workspaceId, workspace.id)),
    );
    expect(logs).toHaveLength(0);
  });
});

describe("tenant isolation at the Orchestrator level", () => {
  it("handleCustomerMessage can't reach a conversation belonging to a different workspace", async () => {
    const workspaceA = await createWorkspace();
    const workspaceB = await createWorkspace();
    const conversationA = await createConversation(workspaceA.id);

    await expect(
      handleCustomerMessage(
        { workspaceId: workspaceB.id, conversationId: conversationA.id, content: "hi" },
        { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() } satisfies OrchestratorDeps,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("claimConversation can't reach a conversation belonging to a different workspace", async () => {
    const workspaceA = await createWorkspace();
    const workspaceB = await createWorkspace();
    const conversationA = await createConversation(workspaceA.id);
    const agentB = await createUser(workspaceB.id);

    await expect(claimConversation(workspaceB.id, conversationA.id, agentB.id)).rejects.toThrow(NotFoundError);
  });
});
