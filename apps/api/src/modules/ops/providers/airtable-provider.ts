import type {
  EscalationContactSyncInput,
  EscalationContactSyncResult,
  EscalationSyncProvider,
} from "../escalation-sync-provider.js";

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

interface AirtableConfig {
  apiKey: string;
  baseId: string;
  tableName: string;
}

interface AirtableRecordResponse {
  id: string;
}

/**
 * The platform's own internal escalation mirror - one Airtable base/
 * table for the whole platform (env.ts: AIRTABLE_API_KEY/BASE_ID/
 * TABLE_NAME), constructed once as a singleton by escalation-sync.service.ts,
 * never per-workspace. No workspace ever sees or configures this token;
 * "which business this record is about" travels as a plain field
 * (workspaceName) in the synced data, not as a separate connection.
 */
export class AirtableEscalationProvider implements EscalationSyncProvider {
  constructor(private readonly config: AirtableConfig) {}

  // Update, not a second create, when a prior sync already produced a
  // record (input.existingRecordId) - a corrected resubmission must
  // never leave a duplicate row in the platform's Airtable base for the
  // same conversation.
  async syncEscalationContact(input: EscalationContactSyncInput): Promise<EscalationContactSyncResult> {
    const baseUrl = `${AIRTABLE_API_BASE}/${encodeURIComponent(this.config.baseId)}/${encodeURIComponent(this.config.tableName)}`;
    const url = input.existingRecordId ? `${baseUrl}/${encodeURIComponent(input.existingRecordId)}` : baseUrl;

    const response = await fetch(url, {
      method: input.existingRecordId ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          Name: input.name,
          "Contact Method": input.contactMethod,
          "Contact Value": input.contactValue,
          Workspace: input.workspaceName,
          "Conversation ID": input.conversationId,
          "Escalation Reason": input.escalationReason,
          "Escalation Detail": input.escalationDetail,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Airtable escalation sync failed with status ${response.status}.`);
    }

    const body = (await response.json()) as AirtableRecordResponse;
    return { recordId: body.id, sourceProvider: "airtable" };
  }

  /**
   * Not part of EscalationSyncProvider, and not currently called
   * anywhere automatically - a manual check available for confirming
   * the platform's own AIRTABLE_* config is correct (right token scope,
   * right field names) without waiting for a real escalation to reveal
   * a problem. Deliberately a real create-then-delete, not a GET - the
   * only real feature here (syncEscalationContact) only ever writes, and
   * Airtable's API rejects a POST referencing a field name the table
   * doesn't already have (it does not auto-create columns, and a bad
   * column name looks identical to a bad token: both are just a non-2xx
   * response). The test record is deleted immediately after, so a check
   * never leaves synthetic data behind in the base.
   */
  async verifyConnection(): Promise<void> {
    const url = `${AIRTABLE_API_BASE}/${encodeURIComponent(this.config.baseId)}/${encodeURIComponent(this.config.tableName)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          Name: "Connection test",
          "Contact Method": "email",
          "Contact Value": "test@example.test",
          Workspace: "Connection test",
          "Conversation ID": "connection-test",
          "Escalation Reason": "connection_test",
          "Escalation Detail": "Created at startup to verify write access and field names; deleted immediately.",
        },
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Airtable connection check failed with status ${response.status}. Make sure the table has these ` +
          "exact fields: Name, Contact Method, Contact Value, Workspace, Conversation ID, Escalation Reason, " +
          "Escalation Detail - and that the token has write access to this base.",
      );
    }

    const body = (await response.json()) as AirtableRecordResponse;
    await fetch(`${url}/${encodeURIComponent(body.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
    }).catch(() => {});
  }
}
