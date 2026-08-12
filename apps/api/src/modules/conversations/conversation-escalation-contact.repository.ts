import { conversationEscalationContacts, type ScopedDb } from "@csa/db";
import { and, eq } from "drizzle-orm";
import { assertDefined } from "../../assert.js";

export type EscalationContactMethod = (typeof conversationEscalationContacts.$inferSelect)["contactMethod"];
export type EscalationContactSyncStatus = (typeof conversationEscalationContacts.$inferSelect)["airtableSyncStatus"];

type NewEscalationContact = Pick<
  typeof conversationEscalationContacts.$inferInsert,
  "workspaceId" | "conversationId" | "name" | "contactMethod" | "contactValue" | "escalationReason" | "escalationDetail"
>;

// Upsert, not insert - conversation_escalation_contacts has a unique
// index on conversation_id (see the schema comment), so a customer
// resubmitting (e.g. fixing a typo) updates the same row instead of
// erroring or duplicating. Resets airtableSyncStatus to 'pending' on
// resubmission so a corrected value actually gets synced again -
// deliberately does NOT touch airtableRecordId, so a resubmission's
// sync updates the same already-created Airtable record instead of
// creating a second one for the same conversation.
export async function upsertEscalationContact(scopedDb: ScopedDb, params: NewEscalationContact) {
  const [contact] = await scopedDb
    .insert(conversationEscalationContacts)
    .values(params)
    .onConflictDoUpdate({
      target: conversationEscalationContacts.conversationId,
      set: {
        name: params.name,
        contactMethod: params.contactMethod,
        contactValue: params.contactValue,
        escalationReason: params.escalationReason,
        escalationDetail: params.escalationDetail,
        airtableSyncStatus: "pending",
        updatedAt: new Date(),
      },
    })
    .returning();
  return assertDefined(contact, "upsertEscalationContact: INSERT ... RETURNING produced no row.");
}

// Column-limited on purpose, not `.select()` - this is what the
// dashboard's GET /conversations/:id response is built from
// (conversation.routes.ts), and escalationReason/escalationDetail/
// airtableSyncStatus/airtableRecordId are the platform's own internal
// escalation-mirror bookkeeping, never a workspace's concern (Airtable
// is invisible to customer workspaces by design - see modules/ops/).
// Only what a workspace's own agent needs to actually follow up with
// their customer is selected.
export async function getEscalationContactByConversationId(
  scopedDb: ScopedDb,
  workspaceId: string,
  conversationId: string,
) {
  const [contact] = await scopedDb
    .select({
      id: conversationEscalationContacts.id,
      name: conversationEscalationContacts.name,
      contactMethod: conversationEscalationContacts.contactMethod,
      contactValue: conversationEscalationContacts.contactValue,
      createdAt: conversationEscalationContacts.createdAt,
    })
    .from(conversationEscalationContacts)
    .where(
      and(
        eq(conversationEscalationContacts.workspaceId, workspaceId),
        eq(conversationEscalationContacts.conversationId, conversationId),
      ),
    );
  return contact ?? null;
}

// airtableRecordId is only ever passed on a successful sync (undefined
// on failure) - a failed attempt must never overwrite a previously
// recorded id with undefined, since that id is what makes the next
// retry an update instead of a duplicate create.
export async function updateEscalationContactSyncStatus(
  scopedDb: ScopedDb,
  id: string,
  status: EscalationContactSyncStatus,
  airtableRecordId?: string,
): Promise<void> {
  await scopedDb
    .update(conversationEscalationContacts)
    .set({
      airtableSyncStatus: status,
      updatedAt: new Date(),
      ...(airtableRecordId ? { airtableRecordId } : {}),
    })
    .where(eq(conversationEscalationContacts.id, id));
}
