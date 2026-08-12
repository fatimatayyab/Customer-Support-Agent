import { randomUUID } from "node:crypto";
import { conversationRatings, conversations, messages, withWorkspaceContext } from "@csa/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { escalateConversation, updateConversationStatus } from "../conversations/conversation.repository.js";
import { insertMessage, type MessageMetadata } from "../conversations/message.repository.js";
import { insertKnowledgeSource } from "../knowledge/knowledge-source.repository.js";
import { rateConversation } from "../../orchestrator/support-orchestrator.js";
import { createConversation, createWorkspace } from "../../test-support/fixtures.js";
import { resetDatabase } from "../../test-support/reset-database.js";
import { getAnalyticsOverview } from "./analytics.service.js";

// A thin builder over the real insertMessage repository function, same
// spirit as test-support/fixtures.ts - not exported there because this
// shape (an 'ai' message with a full MessageMetadata payload) is only
// ever needed by analytics tests.
async function insertAiMessage(workspaceId: string, conversationId: string, overrides: Partial<MessageMetadata> = {}) {
  return withWorkspaceContext(workspaceId, (scopedDb) =>
    insertMessage(scopedDb, {
      workspaceId,
      conversationId,
      senderType: "ai",
      content: "A generated reply.",
      metadata: {
        provider: "gemini",
        model: "gemini-flash-latest",
        promptVersion: 1,
        confidence: 0.9,
        citations: [],
        usage: { inputTokens: 10, outputTokens: 10 },
        finishReason: "stop",
        ...overrides,
      },
    }),
  );
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

describe("getAnalyticsOverview", () => {
  it("returns an empty-but-well-formed overview for a workspace with no activity", async () => {
    const workspace = await createWorkspace();

    const overview = await getAnalyticsOverview(workspace.id, 30);

    expect(overview.totalConversations).toBe(0);
    expect(overview.resolutionRate).toBeNull();
    expect(overview.escalationRate).toBeNull();
    expect(overview.volumeByDay).toEqual([]);
    expect(overview.statusBreakdown).toEqual([]);
    expect(overview.escalationReasonBreakdown).toEqual([]);
    expect(overview.aiStats.totalAiMessages).toBe(0);
    expect(overview.aiStats.avgConfidence).toBeNull();
    expect(overview.topCitedSources).toEqual([]);
    expect(overview.totalRatings).toBe(0);
    expect(overview.csatScore).toBeNull();
    expect(overview.csatBreakdown).toEqual([]);
  });

  it("breaks down conversations by status and computes a resolution rate", async () => {
    const workspace = await createWorkspace();
    await createConversation(workspace.id);
    await createConversation(workspace.id);
    const resolved = await createConversation(workspace.id);
    const closed = await createConversation(workspace.id);
    await withWorkspaceContext(workspace.id, (scopedDb) =>
      updateConversationStatus(scopedDb, workspace.id, resolved.id, "resolved"),
    );
    await withWorkspaceContext(workspace.id, (scopedDb) =>
      updateConversationStatus(scopedDb, workspace.id, closed.id, "closed"),
    );

    const overview = await getAnalyticsOverview(workspace.id, 30);

    expect(overview.totalConversations).toBe(4);
    // 2 of 4 (resolved + closed) count as resolved.
    expect(overview.resolutionRate).toBeCloseTo(0.5);
    const byStatus = Object.fromEntries(overview.statusBreakdown.map((row) => [row.status, row.count]));
    expect(byStatus).toEqual({ open: 2, resolved: 1, closed: 1 });
  });

  it("keeps counting an escalation in the reason breakdown after the conversation is later resolved", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    await withWorkspaceContext(workspace.id, (scopedDb) =>
      escalateConversation(scopedDb, workspace.id, conversation.id, { reason: "no_relevant_knowledge", detail: "test" }),
    );
    await withWorkspaceContext(workspace.id, (scopedDb) =>
      updateConversationStatus(scopedDb, workspace.id, conversation.id, "resolved"),
    );

    const overview = await getAnalyticsOverview(workspace.id, 30);

    // "Ever escalated", not "currently in escalated status" - the
    // conversation's current status is 'resolved', but the escalation
    // metadata is never cleared, and the rate is meant to reflect that.
    expect(overview.escalationRate).toBe(1);
    expect(overview.escalationReasonBreakdown).toEqual([{ reason: "no_relevant_knowledge", count: 1 }]);
    expect(overview.statusBreakdown).toEqual([{ status: "resolved", count: 1 }]);
  });

  it("groups multiple escalation reasons independently", async () => {
    const workspace = await createWorkspace();
    const a = await createConversation(workspace.id);
    const b = await createConversation(workspace.id);
    const c = await createConversation(workspace.id);
    await withWorkspaceContext(workspace.id, (scopedDb) =>
      escalateConversation(scopedDb, workspace.id, a.id, { reason: "no_relevant_knowledge", detail: "x" }),
    );
    await withWorkspaceContext(workspace.id, (scopedDb) =>
      escalateConversation(scopedDb, workspace.id, b.id, { reason: "no_relevant_knowledge", detail: "x" }),
    );
    await withWorkspaceContext(workspace.id, (scopedDb) =>
      escalateConversation(scopedDb, workspace.id, c.id, { reason: "low_confidence", detail: "x" }),
    );

    const overview = await getAnalyticsOverview(workspace.id, 30);

    const byReason = Object.fromEntries(overview.escalationReasonBreakdown.map((row) => [row.reason, row.count]));
    expect(byReason).toEqual({ no_relevant_knowledge: 2, low_confidence: 1 });
  });

  it("aggregates AI confidence, provider/model split, and token usage", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    await insertAiMessage(workspace.id, conversation.id, {
      provider: "gemini",
      model: "gemini-flash-latest",
      confidence: 0.8,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    await insertAiMessage(workspace.id, conversation.id, {
      provider: "gemini",
      model: "gemini-flash-latest",
      confidence: 0.6,
      usage: { inputTokens: 80, outputTokens: 40 },
    });
    await insertAiMessage(workspace.id, conversation.id, {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      confidence: 1.0,
      usage: { inputTokens: 120, outputTokens: 60 },
    });

    const overview = await getAnalyticsOverview(workspace.id, 30);

    expect(overview.aiStats.totalAiMessages).toBe(3);
    expect(overview.aiStats.avgConfidence).toBeCloseTo((0.8 + 0.6 + 1.0) / 3);
    expect(overview.aiStats.totalInputTokens).toBe(300);
    expect(overview.aiStats.totalOutputTokens).toBe(150);
    const byProvider = Object.fromEntries(overview.aiStats.byProvider.map((row) => [row.provider, row.count]));
    expect(byProvider).toEqual({ gemini: 2, anthropic: 1 });
    const byModel = Object.fromEntries(overview.aiStats.byModel.map((row) => [row.model, row.count]));
    expect(byModel).toEqual({ "gemini-flash-latest": 2, "claude-haiku-4-5": 1 });
  });

  it("ranks knowledge sources by how often they're cited across AI replies", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);
    const sourceA = await withWorkspaceContext(workspace.id, (scopedDb) =>
      insertKnowledgeSource(scopedDb, {
        workspaceId: workspace.id,
        type: "plain_text",
        title: "Refund Policy",
        content: "Refunds within 30 days.",
      }),
    );
    const sourceB = await withWorkspaceContext(workspace.id, (scopedDb) =>
      insertKnowledgeSource(scopedDb, {
        workspaceId: workspace.id,
        type: "plain_text",
        title: "Shipping FAQ",
        content: "Ships in 3-5 days.",
      }),
    );

    await insertAiMessage(workspace.id, conversation.id, {
      citations: [{ knowledgeChunkId: randomUUID(), knowledgeSourceId: sourceA.id, similarity: 0.6 }],
    });
    await insertAiMessage(workspace.id, conversation.id, {
      citations: [{ knowledgeChunkId: randomUUID(), knowledgeSourceId: sourceA.id, similarity: 0.5 }],
    });
    await insertAiMessage(workspace.id, conversation.id, {
      citations: [{ knowledgeChunkId: randomUUID(), knowledgeSourceId: sourceB.id, similarity: 0.4 }],
    });

    const overview = await getAnalyticsOverview(workspace.id, 30);

    expect(overview.topCitedSources).toEqual([
      { knowledgeSourceId: sourceA.id, title: "Refund Policy", citationCount: 2 },
      { knowledgeSourceId: sourceB.id, title: "Shipping FAQ", citationCount: 1 },
    ]);
  });

  it("computes a CSAT score and breakdown from submitted ratings", async () => {
    const workspace = await createWorkspace();
    const up1 = await createConversation(workspace.id);
    const up2 = await createConversation(workspace.id);
    const down1 = await createConversation(workspace.id);
    await rateConversation(workspace.id, up1.id, "up");
    await rateConversation(workspace.id, up2.id, "up");
    await rateConversation(workspace.id, down1.id, "down");

    const overview = await getAnalyticsOverview(workspace.id, 30);

    expect(overview.totalRatings).toBe(3);
    expect(overview.csatScore).toBeCloseTo(2 / 3);
    const byRating = Object.fromEntries(overview.csatBreakdown.map((row) => [row.rating, row.count]));
    expect(byRating).toEqual({ up: 2, down: 1 });
  });

  it("re-rating the same conversation updates the score rather than double-counting", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    await rateConversation(workspace.id, conversation.id, "up");
    await rateConversation(workspace.id, conversation.id, "down");

    const overview = await getAnalyticsOverview(workspace.id, 30);

    expect(overview.totalRatings).toBe(1);
    expect(overview.csatScore).toBe(0);
    expect(overview.csatBreakdown).toEqual([{ rating: "down", count: 1 }]);
  });

  it("excludes conversations, messages, and ratings older than the requested day range", async () => {
    const workspace = await createWorkspace();
    const oldConversation = await createConversation(workspace.id);
    await createConversation(workspace.id);
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.update(conversations).set({ createdAt: longAgo }).where(eq(conversations.id, oldConversation.id)),
    );
    const oldMessage = await insertAiMessage(workspace.id, oldConversation.id);
    await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.update(messages).set({ createdAt: longAgo }).where(eq(messages.id, oldMessage.id)),
    );
    await rateConversation(workspace.id, oldConversation.id, "up");
    await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb
        .update(conversationRatings)
        .set({ createdAt: longAgo })
        .where(eq(conversationRatings.conversationId, oldConversation.id)),
    );

    const overview = await getAnalyticsOverview(workspace.id, 30);

    expect(overview.totalConversations).toBe(1);
    expect(overview.aiStats.totalAiMessages).toBe(0);
    expect(overview.totalRatings).toBe(0);
  });

  describe("tenant isolation", () => {
    it("a workspace's overview never includes another workspace's conversations, AI messages, or ratings", async () => {
      const workspaceA = await createWorkspace();
      const workspaceB = await createWorkspace();
      const conversationA = await createConversation(workspaceA.id);
      await insertAiMessage(workspaceA.id, conversationA.id);
      await rateConversation(workspaceA.id, conversationA.id, "up");
      await withWorkspaceContext(workspaceA.id, (scopedDb) =>
        escalateConversation(scopedDb, workspaceA.id, conversationA.id, { reason: "no_relevant_knowledge", detail: "x" }),
      );

      const overviewB = await getAnalyticsOverview(workspaceB.id, 30);

      expect(overviewB.totalConversations).toBe(0);
      expect(overviewB.aiStats.totalAiMessages).toBe(0);
      expect(overviewB.escalationReasonBreakdown).toEqual([]);
      expect(overviewB.totalRatings).toBe(0);
    });
  });
});
