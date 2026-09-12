import { messageAttachments, messages, withWorkspaceContext } from "@csa/db";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { claimConversation, handleCustomerMessage, initiateConversation, uploadMessageAttachment } from "./support-orchestrator.js";
import { getConversationById } from "../modules/conversations/conversation.repository.js";
import { listMessages } from "../modules/conversations/message.repository.js";
import { NO_RELEVANT_KNOWLEDGE_MESSAGE, PROVIDER_ERROR_MESSAGE } from "../modules/ai/prompts/fallback-messages.js";
import { createConversation, createUser, createWorkspace } from "../test-support/fixtures.js";
import { resetDatabase } from "../test-support/reset-database.js";
import { SynchronousJobRunner } from "../job-runner.js";
import { FakeAiProvider } from "../test-support/fake-ai-provider.js";
import { FakeEmbeddingProvider } from "../test-support/fake-embedding-provider.js";

// A real PNG so the upload path's magic-number check passes.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

const FILE = { filename: "screenshot.png", mimeType: "image/png", size: PNG_BYTES.length, data: PNG_BYTES };

async function countMessages(workspaceId: string, conversationId: string): Promise<number> {
  return withWorkspaceContext(workspaceId, (scopedDb) =>
    scopedDb
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.workspaceId, workspaceId), eq(messages.conversationId, conversationId)))
      .then((rows) => rows.length),
  );
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

describe("uploadMessageAttachment", () => {
  it("stores the file and returns its metadata without touching any message", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    const attachment = await uploadMessageAttachment(workspace.id, conversation.id, FILE);

    expect(attachment).toEqual({
      id: expect.any(String),
      filename: "screenshot.png",
      mimeType: "image/png",
      size: PNG_BYTES.length,
    });
    // Pending - not yet claimed by any message.
    const rows = await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb
        .select({ messageId: messageAttachments.messageId, data: messageAttachments.data, storageKey: messageAttachments.storageKey })
        .from(messageAttachments)
        .where(eq(messageAttachments.id, attachment.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messageId).toBeNull();
    expect(rows[0]?.data).toEqual(PNG_BYTES);
    expect(rows[0]?.storageKey).toBe(`${workspace.id}/${attachment.id}`);
  });

  it("rejects a conversation that belongs to a different workspace", async () => {
    const workspaceA = await createWorkspace();
    const workspaceB = await createWorkspace();
    const conversationInB = await createConversation(workspaceB.id);

    await expect(uploadMessageAttachment(workspaceA.id, conversationInB.id, FILE)).rejects.toThrow(/Conversation not found/);
  });
});

describe("handleCustomerMessage with attachments", () => {
  it("claims pending attachments onto the message and history carries them", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);
    // Claimed so the AI branch is skipped - this test is about
    // persistence, not AI behavior.
    await claimConversation(workspace.id, conversation.id, agent.id);

    const first = await uploadMessageAttachment(workspace.id, conversation.id, FILE);
    const secondData = Buffer.from("hi");
    const second = await uploadMessageAttachment(workspace.id, conversation.id, {
      filename: "notes.txt",
      mimeType: "text/plain",
      size: secondData.length,
      data: secondData,
    });

    await handleCustomerMessage(
      {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        content: "Here are the files",
        attachmentIds: [first.id, second.id],
      },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() },
    );

    const history = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    const customerMessage = history.find((message) => message.senderType === "customer");
    expect(customerMessage?.content).toBe("Here are the files");
    expect(customerMessage?.attachments).toHaveLength(2);
    expect(customerMessage?.attachments).toEqual(
      expect.arrayContaining([
        { id: first.id, filename: "screenshot.png", mimeType: "image/png", size: PNG_BYTES.length },
        { id: second.id, filename: "notes.txt", mimeType: "text/plain", size: 2 },
      ]),
    );

    // Both claims are persisted - no longer pending.
    const rows = await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb.select().from(messageAttachments).where(eq(messageAttachments.conversationId, conversation.id)),
    );
    expect(rows.every((row) => row.messageId === customerMessage!.id)).toBe(true);
  });

  it("rolls the whole send back when an attachment id doesn't belong to this conversation", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);
    const otherConversation = await createConversation(workspace.id);
    await claimConversation(workspace.id, conversation.id, agent.id);

    const foreign = await uploadMessageAttachment(workspace.id, otherConversation.id, FILE);

    await expect(
      handleCustomerMessage(
        {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          content: "with a foreign attachment",
          attachmentIds: [foreign.id],
        },
        { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() },
      ),
    ).rejects.toThrow(AppError);

    // The message insert was rolled back with the failed claim - no
    // orphaned message, and the attachment is still pending.
    expect(await countMessages(workspace.id, conversation.id)).toBe(1); // just the claim system message
    const foreignRow = await withWorkspaceContext(workspace.id, (scopedDb) =>
      scopedDb
        .select({ messageId: messageAttachments.messageId })
        .from(messageAttachments)
        .where(eq(messageAttachments.id, foreign.id)),
    );
    expect(foreignRow[0]?.messageId).toBeNull();
  });

  it("rejects a re-claim of an already-sent attachment", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);
    await claimConversation(workspace.id, conversation.id, agent.id);

    const attachment = await uploadMessageAttachment(workspace.id, conversation.id, FILE);
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "first", attachmentIds: [attachment.id] },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() },
    );

    await expect(
      handleCustomerMessage(
        { workspaceId: workspace.id, conversationId: conversation.id, content: "second", attachmentIds: [attachment.id] },
        { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() },
      ),
    ).rejects.toThrow(AppError);
  });

  it("does not leak another workspace's attachment into a message", async () => {
    const workspaceA = await createWorkspace();
    const workspaceB = await createWorkspace();
    const agentB = await createUser(workspaceB.id);
    const conversationB = await createConversation(workspaceB.id);
    await claimConversation(workspaceB.id, conversationB.id, agentB.id);

    const conversationA = await createConversation(workspaceA.id);
    const attachmentInA = await uploadMessageAttachment(workspaceA.id, conversationA.id, FILE);

    await expect(
      handleCustomerMessage(
        { workspaceId: workspaceB.id, conversationId: conversationB.id, content: "cross", attachmentIds: [attachmentInA.id] },
        { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() },
      ),
    ).rejects.toThrow(AppError);
  });

  it("preserves the text-only path unchanged", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);
    await claimConversation(workspace.id, conversation.id, agent.id);

    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "just text" },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() },
    );

    const history = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    const customerMessage = history.find((message) => message.senderType === "customer");
    expect(customerMessage?.attachments).toEqual([]);
  });

  it("escalates an attachment-only message as no_relevant_knowledge, never ai_provider_error", async () => {
    const workspace = await createWorkspace();
    const conversation = await createConversation(workspace.id);

    const attachment = await uploadMessageAttachment(workspace.id, conversation.id, FILE);
    // Unclaimed conversation so the AI branch actually runs. The AI
    // provider is deliberately left unconfigured - it throws if called,
    // so a regression that stops short-circuiting blank content would
    // surface as an ai_provider_error escalation and fail below.
    const aiProvider = new FakeAiProvider();
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "", attachmentIds: [attachment.id] },
      { jobRunner: new SynchronousJobRunner(), aiProvider, embeddingProvider: new FakeEmbeddingProvider() },
    );

    const conversationAfter = await withWorkspaceContext(workspace.id, (scopedDb) =>
      getConversationById(scopedDb, workspace.id, conversation.id),
    );
    const metadata = conversationAfter?.metadata as { escalation?: { reason: string } } | null;
    expect(metadata?.escalation?.reason).toBe("no_relevant_knowledge");
    expect(aiProvider.generateReplyInputs).toEqual([]);

    const history = await withWorkspaceContext(workspace.id, (scopedDb) =>
      listMessages(scopedDb, workspace.id, conversation.id),
    );
    const contents = history.map((message) => message.content);
    expect(contents).toContain(NO_RELEVANT_KNOWLEDGE_MESSAGE);
    expect(contents).not.toContain(PROVIDER_ERROR_MESSAGE);
  });
});

describe("initiateConversation history includes attachments", () => {
  it("returns attachments on resumed history", async () => {
    const workspace = await createWorkspace();
    const agent = await createUser(workspace.id);
    const conversation = await createConversation(workspace.id);
    await claimConversation(workspace.id, conversation.id, agent.id);

    const attachment = await uploadMessageAttachment(workspace.id, conversation.id, FILE);
    await handleCustomerMessage(
      { workspaceId: workspace.id, conversationId: conversation.id, content: "with file", attachmentIds: [attachment.id] },
      { jobRunner: new SynchronousJobRunner(), aiProvider: new FakeAiProvider() },
    );

    const resumed = await initiateConversation({ workspaceId: workspace.id, conversationId: conversation.id });
    const customerMessage = resumed.messages.find((message) => message.senderType === "customer");
    expect(customerMessage?.attachments).toEqual([
      { id: attachment.id, filename: "screenshot.png", mimeType: "image/png", size: PNG_BYTES.length },
    ]);
  });
});