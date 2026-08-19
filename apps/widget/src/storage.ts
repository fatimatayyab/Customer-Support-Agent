const CUSTOMER_ID_KEY = "csa_customer_id";
const CONVERSATION_ID_KEY = "csa_conversation_id";

// Scoped to the host page's own origin (the business's website), not
// the platform's - this is exactly what lets two tabs of the same
// customer's site share one identity and see each other's messages
// sync live through the same conversation.
//
// Every access is wrapped in try/catch, matching config.ts's
// readStoredApiKey/clearDevApiKey pattern: storage can throw in a
// locked-down embedding context (e.g. a sandboxed iframe, or a
// visitor's strict privacy/storage settings on a real customer site).
// Without this, a throw here would surface inside ws-client.ts's
// connect flow and leave the widget permanently stuck showing
// "Connecting..." for that page view, with no fallback other than
// starting a fresh, non-resumed conversation.
export function getStoredCustomerId(): string | null {
  try {
    return localStorage.getItem(CUSTOMER_ID_KEY);
  } catch {
    return null;
  }
}

export function getStoredConversationId(): string | null {
  try {
    return localStorage.getItem(CONVERSATION_ID_KEY);
  } catch {
    return null;
  }
}

export function storeConversation(customerId: string, conversationId: string): void {
  try {
    localStorage.setItem(CUSTOMER_ID_KEY, customerId);
    localStorage.setItem(CONVERSATION_ID_KEY, conversationId);
  } catch {
    // See getStoredCustomerId - storage can throw in a locked-down
    // context. The conversation still works for this page view; it
    // just won't be resumable on a reload/new tab without storage.
  }
}
