import { randomUUID } from "node:crypto";
import {
  conversationEscalationContacts,
  conversationEscalations,
  conversationRatings,
  integrationActionLogs,
  withWorkspaceContext,
} from "@csa/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../errors.js";
import { escalateConversation, getConversationById } from "../modules/conversations/conversation.repository.js";
import { getEscalationContactByConversationId } from "../modules/conversations/conversation-escalation-contact.repository.js";
import { listConversationNotes } from "../modules/conversations/conversation-note.repository.js";
import { listMessages } from "../modules/conversations/message.repository.js";
import {
  CONTACT_RECEIVED_MESSAGE,
  CUSTOMER_REQUESTED_HUMAN_MESSAGE,
  PROVIDER_ERROR_MESSAGE,
} from "../modules/ai/prompts/fallback-messages.js";
import { encryptCredentials } from "../modules/integrations/credential-crypto.js";
import { upsertIntegration } from "../modules/integrations/integration.repository.js";
import { insertKnowledgeChunks } from "../modules/knowledge/knowledge-chunk.repository.js";
import { insertKnowledgeSource } from "../modules/knowledge/knowledge-source.repository.js";
import { SynchronousJobRunner } from "../job-runner.js";
import { FakeAiProvider } from "../test-support/fake-ai-provider.js";
import { FakeEmbeddingProvider } from "../test-support/fake-embedding-provider.js";
import { FakeEscalationSyncProvider } from "../test-support/fake-escalation-sync-provider.js";
import { FakeIntegrationProvider, fakeIntegrationProviderFactory } from "../test-support/fake-integration-provider.js";
import { createConversation, createCustomer, createUser, createWorkspace } from "../test-support/fixtures.js";
import { resetDatabase } from "../test-support/reset-database.js";
import {
  addInternalNote,
  captureEscalationContact,
  changeConversationStatus,
  claimConversation,
  handleCustomerMessage,
  initiateConversation,
  lookupContact,
  rateConversation,
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

  it("reports hasEscalationContact: false for a conversation with no captured contact yet", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    const result = await initiateConversation({ workspaceId: workspace.id, conversationId: conversation.id });

    expect(result.hasEscalationContact).toBe(false);
  });

  it("reports hasEscalationContact: false for a brand-new conversation", async () => {
    const workspace = await createWorkspace();

    const result = await initiateConversation({ workspaceId: workspace.id });

    expect(result.hasEscalationContact).toBe(false);
  });

  it("reports hasEscalationContact: true once a contact has been captured for this conversation - the widget's signal not to re-offer the form on a resumed session", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    await captureEscalationContact(
      workspace.id,
      conversation.id,
      { name: "Jane Doe", contactMethod: "email", contactValue: "jane@example.test" },
      { jobRunner: new SynchronousJobRunner(), escalationSyncProvider: null },
    );

    const result = await initiateConversation({ workspaceId: workspace.id, conversationId: conversation.id });

    expect(result.hasEscalationContact).toBe(true);
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

  it("stores pageUrl/pageTitle on the customer message's own metadata when the widget sends them", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    await handleCustomerMessage(
      {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        content: "Where's my order?",
        pageUrl: "https://example.com/orders",
        pageTitle: "My Orders",
      },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() },
    );

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    const customerMessage = messages.find((message) => message.senderType === "customer");
    expect(customerMessage?.metadata).toMatchObject({
      pageUrl: "https://example.com/orders",
      pageTitle: "My Orders",
    });
  });

  it("does not attach page-context metadata when the widget sends no pageUrl", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "Where's my order?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() },
    );

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    const customerMessage = messages.find((message) => message.senderType === "customer");
    expect(customerMessage?.metadata ?? null).toBeNull();
  });

  it("passes pageContext through to the AI provider when the widget sends it", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const embeddingProvider = new FakeEmbeddingProvider();
    await seedRelevantKnowledge(workspace.id, embeddingProvider);
    const aiProvider = new FakeAiProvider().mockReply({ confidence: 0.95 });

    await handleCustomerMessage(
      {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        content: "Can I get a refund?",
        pageUrl: "https://example.com/refund-policy",
        pageTitle: "Refund Policy",
      },
      { jobRunner: new SynchronousJobRunner(), aiProvider, embeddingProvider },
    );

    expect(aiProvider.lastGenerateReplyInput?.pageContext).toEqual({
      url: "https://example.com/refund-policy",
      title: "Refund Policy",
    });
  });

  it("passes no pageContext to the AI provider when the widget sends no pageUrl", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const embeddingProvider = new FakeEmbeddingProvider();
    await seedRelevantKnowledge(workspace.id, embeddingProvider);
    const aiProvider = new FakeAiProvider().mockReply({ confidence: 0.95 });

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "Can I get a refund?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider, embeddingProvider },
    );

    expect(aiProvider.lastGenerateReplyInput?.pageContext).toBeUndefined();
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

  describe("Stage 1: AI-triggered lookup_contact eligibility gate", () => {
    async function connectFakeIntegration(workspaceId: string, config: Record<string, unknown> = {}) {
      const credentials = await encryptCredentials({ accessToken: "fake-token" });
      return withWorkspaceContext(workspaceId, (scopedDb) =>
        upsertIntegration(scopedDb, { workspaceId, provider: "hubspot", credentials, config }),
      );
    }

    it("still escalates via no_relevant_knowledge for an unrelated message, even with a connected+enabled integration", async () => {
      const workspace = await createWorkspace();
      const conversation = await createConversation(workspace.id);
      await connectFakeIntegration(workspace.id, { aiToolCallingEnabled: true });
      const aiProvider = new FakeAiProvider();

      await handleCustomerMessage(
        { workspaceId: workspace.id, conversationId: conversation.id, content: "what's the weather like today?" },
        { jobRunner: new SynchronousJobRunner(), aiProvider, embeddingProvider: new FakeEmbeddingProvider() },
      );

      const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
        getConversationById(scopedDb, workspace.id, conversation.id),
      );
      const metadata = conversationAfter?.metadata as { escalation?: { reason: string } } | null;
      expect(metadata?.escalation?.reason).toBe("no_relevant_knowledge");
      // The core behavior this gate exists for: a connected+enabled
      // integration must not, by itself, get an unrelated question past
      // the model-never-called fast path.
      expect(aiProvider.generateReplyInputs).toHaveLength(0);
    });

    it("keeps the toggle-off fast path unchanged even for an otherwise-eligible-looking message", async () => {
      const workspace = await createWorkspace();
      const conversation = await createConversation(workspace.id);
      await connectFakeIntegration(workspace.id); // aiToolCallingEnabled left off (default)
      const aiProvider = new FakeAiProvider();

      await handleCustomerMessage(
        {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          content: "Am I an existing customer? My email is jane@example.com",
        },
        { jobRunner: new SynchronousJobRunner(), aiProvider, embeddingProvider: new FakeEmbeddingProvider() },
      );

      const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
        getConversationById(scopedDb, workspace.id, conversation.id),
      );
      const metadata = conversationAfter?.metadata as { escalation?: { reason: string } } | null;
      expect(metadata?.escalation?.reason).toBe("no_relevant_knowledge");
      expect(aiProvider.generateReplyInputs).toHaveLength(0);
    });

    it("completes the bounded two-call flow and records the tool attempt when eligible and authorized", async () => {
      const workspace = await createWorkspace();
      const conversation = await createConversation(workspace.id);
      await connectFakeIntegration(workspace.id, { aiToolCallingEnabled: true });
      const integrationProvider = new FakeIntegrationProvider().mockFound({
        name: "Jane Doe",
        email: "jane@example.com",
        company: "Acme Co",
        lifecycleStage: "customer",
      });
      const aiProvider = new FakeAiProvider()
        .queueReply({
          kind: "tool_call",
          tool: "lookup_contact",
          args: { email: "jane@example.com" },
          provider: "fake",
          model: "fake-model",
          promptVersion: 1,
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .queueReply({
          kind: "reply",
          reply: "Yes, I found your account, Jane.",
          confidence: 0.9,
          needsEscalation: false,
          citations: [],
          provider: "fake",
          model: "fake-model",
          promptVersion: 1,
          usage: { inputTokens: 10, outputTokens: 10 },
          finishReason: "stop",
        });

      await handleCustomerMessage(
        {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          content: "Am I an existing customer? My email is jane@example.com",
        },
        {
          jobRunner: new SynchronousJobRunner(),
          aiProvider,
          embeddingProvider: new FakeEmbeddingProvider(),
          integrationProviderFactory: fakeIntegrationProviderFactory(integrationProvider),
        },
      );

      expect(integrationProvider.calls).toEqual([{ email: "jane@example.com" }]);

      const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
        listMessages(scopedDb, workspace.id, conversation.id),
      );
      const aiMessage = messages.find((message) => message.senderType === "ai");
      const metadata = aiMessage?.metadata as { toolAttempted?: string; toolOutcome?: string } | null;
      expect(metadata?.toolAttempted).toBe("lookup_contact");
      expect(metadata?.toolOutcome).toBe("found");

      const logs = await withWorkspaceContext(workspace.id, (scopedDb) =>
        scopedDb.select().from(integrationActionLogs).where(eq(integrationActionLogs.workspaceId, workspace.id)),
      );
      expect(logs).toHaveLength(1);
      expect(logs[0]?.triggeredBy).toBe("ai");
      expect(logs[0]?.triggeredByUserId).toBeNull();

      // conversation_notes.userId is NOT NULL and there is no human
      // author for an AI-triggered lookup - deliberately no note.
      const notes = await withWorkspaceContext(workspace.id, (scopedDb) =>
        listConversationNotes(scopedDb, workspace.id, conversation.id),
      );
      expect(notes).toHaveLength(0);
    });

    it("never executes the lookup when the model requests an email the customer never actually typed, and falls back deterministically since there's no other grounding", async () => {
      const workspace = await createWorkspace();
      const conversation = await createConversation(workspace.id);
      await connectFakeIntegration(workspace.id, { aiToolCallingEnabled: true });
      const integrationProvider = new FakeIntegrationProvider().mockFound({ email: "someone-else@example.com" });
      const aiProvider = new FakeAiProvider().queueReply({
        kind: "tool_call",
        tool: "lookup_contact",
        // Not the email the customer supplied below - simulates a
        // hallucinated or knowledge-injected email.
        args: { email: "someone-else@example.com" },
        provider: "fake",
        model: "fake-model",
        promptVersion: 1,
        usage: { inputTokens: 10, outputTokens: 10 },
      });
      // No second queued reply: with zero knowledge chunks and a
      // rejected email, the deterministic no-grounding fallback fires
      // without ever making the forced second call.

      await handleCustomerMessage(
        {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          content: "Am I an existing customer? My email is jane@example.com",
        },
        {
          jobRunner: new SynchronousJobRunner(),
          aiProvider,
          embeddingProvider: new FakeEmbeddingProvider(),
          integrationProviderFactory: fakeIntegrationProviderFactory(integrationProvider),
        },
      );

      expect(integrationProvider.calls).toHaveLength(0);
      expect(aiProvider.generateReplyInputs).toHaveLength(1);

      const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
        getConversationById(scopedDb, workspace.id, conversation.id),
      );
      const conversationMetadata = conversationAfter?.metadata as { escalation?: { reason: string } } | null;
      expect(conversationMetadata?.escalation?.reason).toBe("no_relevant_knowledge");

      const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
        listMessages(scopedDb, workspace.id, conversation.id),
      );
      expect(messages.some((message) => message.senderType === "ai")).toBe(false);
      expect(messages.some((message) => message.senderType === "system")).toBe(true);

      const logs = await withWorkspaceContext(workspace.id, (scopedDb) =>
        scopedDb.select().from(integrationActionLogs).where(eq(integrationActionLogs.workspaceId, workspace.id)),
      );
      expect(logs).toHaveLength(0);
    });

    it("recognizes eligibility across two turns - an account question, then a later bare-email reply", async () => {
      const workspace = await createWorkspace();
      const conversation = await createConversation(workspace.id);
      await connectFakeIntegration(workspace.id, { aiToolCallingEnabled: true });
      const integrationProvider = new FakeIntegrationProvider().mockFound({ email: "jane@example.com" });

      // Turn 1: an account question with no email yet - not eligible
      // (hasIdentifiableEmail fails), falls through to the same
      // deterministic no-knowledge escalation as before this feature
      // existed.
      const aiProviderTurn1 = new FakeAiProvider();
      await handleCustomerMessage(
        { workspaceId: workspace.id, conversationId: conversation.id, content: "Am I an existing customer?" },
        {
          jobRunner: new SynchronousJobRunner(),
          aiProvider: aiProviderTurn1,
          embeddingProvider: new FakeEmbeddingProvider(),
        },
      );
      expect(aiProviderTurn1.generateReplyInputs).toHaveLength(0);

      // Turn 2: customer replies with just the email. This message
      // alone doesn't look like an account question, but turn 1's
      // question is still one turn back in history - the gate must
      // check the conversation, not only the latest message, or this
      // natural two-turn flow never becomes eligible.
      const aiProviderTurn2 = new FakeAiProvider()
        .queueReply({
          kind: "tool_call",
          tool: "lookup_contact",
          args: { email: "jane@example.com" },
          provider: "fake",
          model: "fake-model",
          promptVersion: 1,
          usage: { inputTokens: 10, outputTokens: 10 },
        })
        .queueReply({
          kind: "reply",
          reply: "Yes, I found your account.",
          confidence: 0.9,
          needsEscalation: false,
          citations: [],
          provider: "fake",
          model: "fake-model",
          promptVersion: 1,
          usage: { inputTokens: 10, outputTokens: 10 },
          finishReason: "stop",
        });

      await handleCustomerMessage(
        { workspaceId: workspace.id, conversationId: conversation.id, content: "jane@example.com" },
        {
          jobRunner: new SynchronousJobRunner(),
          aiProvider: aiProviderTurn2,
          embeddingProvider: new FakeEmbeddingProvider(),
          integrationProviderFactory: fakeIntegrationProviderFactory(integrationProvider),
        },
      );

      expect(integrationProvider.calls).toEqual([{ email: "jane@example.com" }]);
    });

    it("forces deterministic escalation when there is no grounding at all, even if the model itself doesn't ask to escalate", async () => {
      const workspace = await createWorkspace();
      const conversation = await createConversation(workspace.id);
      await connectFakeIntegration(workspace.id, { aiToolCallingEnabled: true });
      const integrationProvider = new FakeIntegrationProvider().mockError(new Error("HubSpot is down"));
      // Deliberately overconfident and non-escalating on the first (and
      // only, since the failed lookup + zero knowledge chunks means the
      // second call is skipped) call - proves the fallback below doesn't
      // depend on the model's own judgment.
      const aiProvider = new FakeAiProvider().queueReply({
        kind: "tool_call",
        tool: "lookup_contact",
        args: { email: "jane@example.com" },
        provider: "fake",
        model: "fake-model",
        promptVersion: 1,
        usage: { inputTokens: 10, outputTokens: 10 },
      });

      await handleCustomerMessage(
        {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          content: "Am I an existing customer? My email is jane@example.com",
        },
        {
          jobRunner: new SynchronousJobRunner(),
          aiProvider,
          embeddingProvider: new FakeEmbeddingProvider(),
          integrationProviderFactory: fakeIntegrationProviderFactory(integrationProvider),
        },
      );

      const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
        getConversationById(scopedDb, workspace.id, conversation.id),
      );
      const metadata = conversationAfter?.metadata as { escalation?: { reason: string } } | null;
      expect(metadata?.escalation?.reason).toBe("no_relevant_knowledge");

      const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
        listMessages(scopedDb, workspace.id, conversation.id),
      );
      expect(messages.some((message) => message.senderType === "ai")).toBe(false);
      expect(messages.some((message) => message.senderType === "system")).toBe(true);
    });
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

  it("escalates as customer_requested_human and never calls the AI when the customer explicitly asks for one", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    // Deliberately unconfigured FakeAiProvider/FakeEmbeddingProvider -
    // if isExplicitHumanRequest's fast path doesn't actually short-circuit
    // before retrieval/generation, either fake throws and this test fails.
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "Can I talk to a human please?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider(), embeddingProvider: new FakeEmbeddingProvider() },
    );

    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    const metadata = conversationAfter?.metadata as { escalation?: { reason: string } } | null;
    expect(conversationAfter?.status).toBe("escalated");
    expect(metadata?.escalation?.reason).toBe("customer_requested_human");

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messages.some((message) => message.senderType === "ai")).toBe(false);
    expect(messageContents(messages)).toContainEqual({
      senderType: "system",
      content: CUSTOMER_REQUESTED_HUMAN_MESSAGE,
    });
    const humanRequestMessage = messages.find((message) => message.content === CUSTOMER_REQUESTED_HUMAN_MESSAGE);
    expect((humanRequestMessage?.metadata as { escalated?: boolean } | null)?.escalated).toBe(true);
  });

  it("does not treat a generic mention of 'agent' or 'person' as a request for a human", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const embeddingProvider = new FakeEmbeddingProvider();
    await seedRelevantKnowledge(workspace.id, embeddingProvider);
    const aiProvider = new FakeAiProvider().mockReply({ reply: "Our travel agent can help with that.", confidence: 0.9 });

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "Does your travel agent handle refunds for a person like me?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider, embeddingProvider },
    );

    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    const metadata = conversationAfter?.metadata as { escalation?: { reason: string } } | null;
    expect(metadata?.escalation?.reason).not.toBe("customer_requested_human");
    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messageContents(messages)).toContainEqual({
      senderType: "ai",
      content: "Our travel agent can help with that.",
    });
  });

  it("stamps escalated/escalationReason onto the ai message's own metadata, not just the conversation", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const embeddingProvider = new FakeEmbeddingProvider();
    await seedRelevantKnowledge(workspace.id, embeddingProvider);
    const aiProvider = new FakeAiProvider().mockReply({ reply: "Not sure about that.", confidence: 0.1 });

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "Can I get a refund?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider, embeddingProvider },
    );

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    const aiMessage = messages.find((message) => message.senderType === "ai");
    const metadata = aiMessage?.metadata as { escalated?: boolean; escalationReason?: string } | null;
    expect(metadata?.escalated).toBe(true);
    expect(metadata?.escalationReason).toBe("low_confidence");
  });

  it("preserves every escalation reason across multiple escalations on the same conversation, not just the latest", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    // First escalation: no knowledge base at all -> no_relevant_knowledge.
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "anything?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider(), embeddingProvider: new FakeEmbeddingProvider() },
    );
    // Second, separate escalation on the very same conversation.
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "can I talk to a human?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider(), embeddingProvider: new FakeEmbeddingProvider() },
    );

    // conversations.metadata.escalation stays a "current reason only"
    // snapshot, unchanged behavior - existing readers (queue badge,
    // analytics) still just want the latest.
    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    const metadata = conversationAfter?.metadata as { escalation?: { reason: string } } | null;
    expect(metadata?.escalation?.reason).toBe("customer_requested_human");

    // But the full history table remembers both, in order - this is the
    // part that didn't exist before and is what a human reviewing the
    // conversation actually needs to see.
    const history = await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb
        .select()
        .from(conversationEscalations)
        .where(eq(conversationEscalations.conversationId, conversation.id)),
    );
    expect(history).toHaveLength(2);
    expect(history.map((event) => event.reason).sort()).toEqual(["customer_requested_human", "no_relevant_knowledge"].sort());
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

    const result = await lookupContact(
      workspace.id,
      conversation.id,
      { type: "human", userId: agent.id },
      "jane@example.test",
      { integrationProviderFactory: fakeIntegrationProviderFactory(fakeProvider) },
    );

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

    const result = await lookupContact(
      workspace.id,
      conversation.id,
      { type: "human", userId: agent.id },
      "ghost@example.test",
      { integrationProviderFactory: fakeIntegrationProviderFactory(fakeProvider) },
    );

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
      lookupContact(
        workspace.id,
        conversation.id,
        { type: "human", userId: agent.id },
        "jane@example.test",
        { integrationProviderFactory: fakeIntegrationProviderFactory(fakeProvider) },
      ),
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

    await expect(
      lookupContact(workspace.id, conversation.id, { type: "human", userId: agent.id }, "jane@example.test"),
    ).rejects.toThrow();

    const logs = await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.select().from(integrationActionLogs).where(eq(integrationActionLogs.workspaceId, workspace.id)),
    );
    expect(logs).toHaveLength(0);
  });
});

describe("captureEscalationContact", () => {
  // getEscalationContactByConversationId is column-limited to what the
  // dashboard is allowed to see (name/contactMethod/contactValue only -
  // the platform's internal escalationReason/airtableSyncStatus/
  // airtableRecordId are deliberately never exposed to a workspace, see
  // that function's own comment). Tests verify the platform-internal
  // fields via a direct table query instead, same pattern the
  // lookupContact tests below already use for integration_action_logs.
  async function getFullEscalationContact(workspaceId: string, conversationId: string) {
    const [contact] = await withWorkspaceContext(workspaceId, (scopedDb) =>
      scopedDb.select().from(conversationEscalationContacts).where(eq(conversationEscalationContacts.conversationId, conversationId)),
    );
    return contact ?? null;
  }

  it("saves the contact and sends a confirmation message even with no platform Airtable configured", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    await captureEscalationContact(
      workspace.id,
      conversation.id,
      { name: "Jane Doe", contactMethod: "email", contactValue: "jane@example.test" },
      { jobRunner: new SynchronousJobRunner(), escalationSyncProvider: null },
    );

    const contact = await getFullEscalationContact(workspace.id, conversation.id);
    expect(contact?.name).toBe("Jane Doe");
    // Stays 'pending', not 'failed' - an unconfigured platform mirror is
    // a legitimate no-op, not a sync failure (escalation-sync.service.ts's
    // syncEscalationContact returns null in this case).
    expect(contact?.airtableSyncStatus).toBe("pending");

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messageContents(messages)).toContainEqual({ senderType: "system", content: CONTACT_RECEIVED_MESSAGE });

    // Never surfaced to the dashboard - column-limited select excludes it.
    const dashboardView = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getEscalationContactByConversationId(scopedDb, workspace.id, conversation.id),
    );
    expect(dashboardView).not.toHaveProperty("airtableSyncStatus");
  });

  it("marks the contact synced after a successful sync to the platform mirror", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const fakeProvider = new FakeEscalationSyncProvider().mockSynced();

    await captureEscalationContact(
      workspace.id,
      conversation.id,
      { name: "Jane Doe", contactMethod: "phone", contactValue: "+1-555-0100" },
      { jobRunner: new SynchronousJobRunner(), escalationSyncProvider: fakeProvider },
    );

    const contact = await getFullEscalationContact(workspace.id, conversation.id);
    expect(contact?.airtableSyncStatus).toBe("synced");
  });

  it("marks the contact failed, but still keeps the confirmation message, when the sync errors", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const fakeProvider = new FakeEscalationSyncProvider().mockError(new Error("Airtable is down"));

    await captureEscalationContact(
      workspace.id,
      conversation.id,
      { name: "Jane Doe", contactMethod: "email", contactValue: "jane@example.test" },
      { jobRunner: new SynchronousJobRunner(), escalationSyncProvider: fakeProvider },
    );

    const contact = await getFullEscalationContact(workspace.id, conversation.id);
    expect(contact?.airtableSyncStatus).toBe("failed");

    const messages = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    expect(messageContents(messages)).toContainEqual({ senderType: "system", content: CONTACT_RECEIVED_MESSAGE });
  });

  it("upserts rather than duplicating when the same conversation submits again", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    await captureEscalationContact(
      workspace.id,
      conversation.id,
      { name: "Jane Doe", contactMethod: "email", contactValue: "typo@example.test" },
      { jobRunner: new SynchronousJobRunner(), escalationSyncProvider: null },
    );
    await captureEscalationContact(
      workspace.id,
      conversation.id,
      { name: "Jane Doe", contactMethod: "email", contactValue: "jane@example.test" },
      { jobRunner: new SynchronousJobRunner(), escalationSyncProvider: null },
    );

    const contact = await getFullEscalationContact(workspace.id, conversation.id);
    expect(contact?.contactValue).toBe("jane@example.test");
  });

  it("updates the existing record on resubmission instead of creating a duplicate", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const fakeProvider = new FakeEscalationSyncProvider().mockSynced({ recordId: "airtable-rec-1" });
    const deps = { jobRunner: new SynchronousJobRunner(), escalationSyncProvider: fakeProvider };

    await captureEscalationContact(
      workspace.id,
      conversation.id,
      { name: "Jane Doe", contactMethod: "email", contactValue: "typo@example.test" },
      deps,
    );
    await captureEscalationContact(
      workspace.id,
      conversation.id,
      { name: "Jane Doe", contactMethod: "email", contactValue: "jane@example.test" },
      deps,
    );

    expect(fakeProvider.calls).toHaveLength(2);
    expect(fakeProvider.calls[0]?.existingRecordId).toBeUndefined();
    expect(fakeProvider.calls[1]?.existingRecordId).toBe("airtable-rec-1");

    const contact = await getFullEscalationContact(workspace.id, conversation.id);
    expect(contact?.airtableRecordId).toBe("airtable-rec-1");
  });

  it("snapshots the escalation reason at capture time, not whatever the conversation says later", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "anything?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider(), embeddingProvider: new FakeEmbeddingProvider() },
    );

    await captureEscalationContact(
      workspace.id,
      conversation.id,
      { name: "Jane Doe", contactMethod: "email", contactValue: "jane@example.test" },
      { jobRunner: new SynchronousJobRunner(), escalationSyncProvider: null },
    );

    // A second, unrelated escalation happens on the same conversation
    // AFTER the contact was captured - escalateConversation's jsonb merge
    // overwrites conversations.metadata.escalation with this new reason.
    // The already-captured contact must still remember the original one.
    await withWorkspaceContext(workspace.id, (scopedDb) =>
      escalateConversation(scopedDb, workspace.id, conversation.id, {
        reason: "ai_requested_escalation",
        detail: "A later, unrelated escalation.",
      }),
    );
    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    expect((conversationAfter?.metadata as { escalation?: { reason: string } })?.escalation?.reason).toBe(
      "ai_requested_escalation",
    );

    const contact = await getFullEscalationContact(workspace.id, conversation.id);
    expect(contact?.escalationReason).toBe("no_relevant_knowledge");
  });

  it("can't reach a conversation belonging to a different workspace", async () => {
    const workspaceA = await createWorkspace();
    const workspaceB = await createWorkspace();
    const conversationA = await createConversation(workspaceA.id);

    await expect(
      captureEscalationContact(
        workspaceB.id,
        conversationA.id,
        { name: "Jane Doe", contactMethod: "email", contactValue: "jane@example.test" },
        { jobRunner: new SynchronousJobRunner(), escalationSyncProvider: null },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("does not attempt a sync for an escalation on a conversation with no captured contact", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    // Deliberately unconfigured - records every call before it would
    // throw, so this still proves zero calls happened rather than
    // silently passing if recordEscalation's resync fired unexpectedly.
    const fakeProvider = new FakeEscalationSyncProvider();

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "anything?" },
      {
        jobRunner: new SynchronousJobRunner(),
        aiProvider: new FakeAiProvider(),
        embeddingProvider: new FakeEmbeddingProvider(),
        escalationSyncProvider: fakeProvider,
      },
    );

    expect(fakeProvider.calls).toHaveLength(0);
  });

  it("re-syncs the platform mirror on a later escalation once a contact already exists, without asking the customer again", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    // First escalation, then a contact is captured for it.
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "anything?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider(), embeddingProvider: new FakeEmbeddingProvider() },
    );
    const fakeProvider = new FakeEscalationSyncProvider().mockSynced({ recordId: "airtable-rec-1" });
    await captureEscalationContact(
      workspace.id,
      conversation.id,
      { name: "Jane Doe", contactMethod: "email", contactValue: "jane@example.test" },
      { jobRunner: new SynchronousJobRunner(), escalationSyncProvider: fakeProvider },
    );
    expect(fakeProvider.calls).toHaveLength(1);

    // A second, later escalation on the same conversation - the widget
    // never re-offers the contact form (the customer already gave one),
    // but the platform mirror still needs to learn about this new reason.
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "can I talk to a human?" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider(), embeddingProvider: new FakeEmbeddingProvider(), escalationSyncProvider: fakeProvider },
    );

    expect(fakeProvider.calls).toHaveLength(2);
    // Updates the same record - never a second, duplicate one.
    expect(fakeProvider.calls[1]?.existingRecordId).toBe("airtable-rec-1");
    // Both reasons show up in the resynced payload, not just the newest.
    expect(fakeProvider.calls[1]?.escalationReason).toContain("no_relevant_knowledge");
    expect(fakeProvider.calls[1]?.escalationReason).toContain("customer_requested_human");

    const contact = await getFullEscalationContact(workspace.id, conversation.id);
    expect(contact?.airtableSyncStatus).toBe("synced");
  });
});

describe("rateConversation", () => {
  it("persists a rating for a real conversation", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    await rateConversation(workspace.id, conversation.id, "up");

    const rows = await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.select().from(conversationRatings).where(eq(conversationRatings.conversationId, conversation.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rating).toBe("up");
  });

  it("upserts rather than duplicating when the same conversation is rated again", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    await rateConversation(workspace.id, conversation.id, "up");
    await rateConversation(workspace.id, conversation.id, "down");

    const rows = await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.select().from(conversationRatings).where(eq(conversationRatings.conversationId, conversation.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rating).toBe("down");
  });

  it("rejects a conversation id that doesn't belong to the workspace", async () => {
    const workspaceA = await createWorkspace();
    const workspaceB = await createWorkspace();
    const conversationA = await createConversation(workspaceA.id);

    await expect(rateConversation(workspaceB.id, conversationA.id, "up")).rejects.toThrow(NotFoundError);
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
