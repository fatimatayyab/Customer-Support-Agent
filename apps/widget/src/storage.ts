const CUSTOMER_ID_KEY = "csa_customer_id";
const CONVERSATION_ID_KEY = "csa_conversation_id";

// Scoped to the host page's own origin (the business's website), not
// the platform's - this is exactly what lets two tabs of the same
// customer's site share one identity and see each other's messages
// sync live through the same conversation.
export function getStoredCustomerId(): string | null {
  return localStorage.getItem(CUSTOMER_ID_KEY);
}

export function getStoredConversationId(): string | null {
  return localStorage.getItem(CONVERSATION_ID_KEY);
}

export function storeConversation(customerId: string, conversationId: string): void {
  localStorage.setItem(CUSTOMER_ID_KEY, customerId);
  localStorage.setItem(CONVERSATION_ID_KEY, conversationId);
}
