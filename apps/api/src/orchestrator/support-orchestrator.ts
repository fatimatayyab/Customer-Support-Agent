import { withWorkspaceContext } from "@csa/db";
import { assertDefined } from "../assert.js";
import { getCustomerById, insertCustomer } from "../modules/customers/customer.repository.js";
import { getConversationById, insertConversation } from "../modules/conversations/conversation.repository.js";
import { insertMessage, listMessages } from "../modules/conversations/message.repository.js";
import { publishToConversation } from "../modules/realtime/conversation-hub.js";
import { NotFoundError } from "../errors.js";

/**
 * This module IS the System Architecture's "Support Orchestrator" - the
 * single coordinator of the customer request lifecycle (03_System_Architecture.md).
 * It owns business logic and application state; downstream capabilities
 * (Knowledge retrieval in Phase 2, AI calls in Phase 3, human handoff in
 * Phase 4, Integration actions in Phase 5) extend the functions here
 * rather than replacing them or being called directly by transport code.
 */

interface InitiateConversationParams {
  workspaceId: string;
  customerId?: string;
  conversationId?: string;
}

export async function initiateConversation(params: InitiateConversationParams) {
  return withWorkspaceContext(params.workspaceId, async (scopedDb) => {
    // A resumable conversationId is authoritative when it resolves: the
    // conversation already implies its customer, so any separately
    // supplied customerId is ignored rather than trusted at face value.
    if (params.conversationId) {
      const conversation = await getConversationById(scopedDb, params.workspaceId, params.conversationId);
      if (conversation) {
        const customer = await getCustomerById(scopedDb, params.workspaceId, conversation.customerId);
        const history = await listMessages(scopedDb, params.workspaceId, conversation.id);
        return {
          customer: assertDefined(customer, "initiateConversation: conversation.customerId has no matching row."),
          conversation,
          messages: history,
        };
      }
      // Stale or invalid conversationId (e.g. from an old localStorage
      // value) - fall through and start fresh below.
    }

    const customer = params.customerId
      ? ((await getCustomerById(scopedDb, params.workspaceId, params.customerId)) ??
        (await insertCustomer(scopedDb, { workspaceId: params.workspaceId })))
      : await insertCustomer(scopedDb, { workspaceId: params.workspaceId });

    const conversation = await insertConversation(scopedDb, {
      workspaceId: params.workspaceId,
      customerId: customer.id,
    });

    return { customer, conversation, messages: [] };
  });
}

interface HandleCustomerMessageParams {
  workspaceId: string;
  conversationId: string;
  content: string;
}

export async function handleCustomerMessage(params: HandleCustomerMessageParams) {
  const message = await withWorkspaceContext(params.workspaceId, async (scopedDb) => {
    const conversation = await getConversationById(scopedDb, params.workspaceId, params.conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found.");
    }

    return insertMessage(scopedDb, {
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
      senderType: "customer",
      content: params.content,
    });
  });

  // Broadcasts to every subscriber including the sender's own
  // connection - the widget renders on this authoritative echo rather
  // than optimistically, so there's exactly one code path for "a
  // message appeared," not two that need to stay in sync.
  publishToConversation(params.conversationId, { type: "message:receive", payload: message });

  return message;
}
