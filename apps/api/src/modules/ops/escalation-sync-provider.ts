/**
 * Abstraction over the platform's own internal escalation mirror - NOT a
 * customer/workspace integration. There is exactly one destination for
 * the whole platform (configured via env.ts, apps/api/src/modules/ops/
 * escalation-sync.service.ts), not a per-workspace connection the way
 * modules/integrations/integration-provider.ts's IntegrationProvider is.
 * A workspace never sees, configures, or knows this exists.
 *
 * Named for the business capability (syncEscalationContact), not the
 * vendor - AirtableProvider is the only implementation today, but
 * nothing outside this module and its provider knows it's Airtable
 * specifically.
 */
export interface EscalationContactSyncInput {
  name: string;
  contactMethod: "email" | "phone";
  contactValue: string;
  conversationId: string;
  // Which workspace/customer this escalation belongs to - always
  // included so the platform-level mirror can distinguish one business's
  // escalations from another's despite the destination itself not being
  // workspace-scoped.
  workspaceName: string;
  escalationReason: string;
  escalationDetail: string;
  // Set on a resync (a corrected resubmission) once a prior sync already
  // produced a record - lets the provider update that same record
  // instead of creating a second one for the same conversation.
  existingRecordId?: string;
}

export interface EscalationContactSyncResult {
  recordId: string;
  sourceProvider: string;
}

export interface EscalationSyncProvider {
  syncEscalationContact(input: EscalationContactSyncInput): Promise<EscalationContactSyncResult>;
}
