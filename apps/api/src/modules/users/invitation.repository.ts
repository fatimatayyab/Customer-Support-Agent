import { and, asc, eq, gt } from "drizzle-orm";
import { invitations, users, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

export type InvitationRole = (typeof invitations.$inferSelect)["role"];

export async function getPendingInvitationByEmail(scopedDb: ScopedDb, workspaceId: string, email: string) {
  const [invitation] = await scopedDb
    .select()
    .from(invitations)
    .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.email, email), eq(invitations.status, "pending")))
    .limit(1);
  return invitation ?? null;
}

export async function insertInvitation(
  scopedDb: ScopedDb,
  params: {
    workspaceId: string;
    email: string;
    role: InvitationRole;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: Date;
  },
) {
  const [invitation] = await scopedDb.insert(invitations).values(params).returning();
  return assertDefined(invitation, "insertInvitation: INSERT ... RETURNING produced no row.");
}

// The other half of "resend" - rotates an existing pending invitation's
// token/expiry/role instead of leaving a stale duplicate row, so the
// pending-invitations list never shows the same email twice.
export async function rotateInvitation(
  scopedDb: ScopedDb,
  workspaceId: string,
  id: string,
  params: { role: InvitationRole; tokenHash: string; invitedByUserId: string; expiresAt: Date },
) {
  const [invitation] = await scopedDb
    .update(invitations)
    .set({ ...params, updatedAt: new Date() })
    .where(and(eq(invitations.id, id), eq(invitations.workspaceId, workspaceId)))
    .returning();
  return assertDefined(invitation, "rotateInvitation: UPDATE ... RETURNING produced no row.");
}

// Joins the inviter's name for display ("invited by Sarah") rather than
// making the dashboard resolve it separately.
export async function listPendingInvitations(scopedDb: ScopedDb, workspaceId: string) {
  return scopedDb
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      invitedByName: users.name,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .innerJoin(users, eq(invitations.invitedByUserId, users.id))
    .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.status, "pending")))
    .orderBy(asc(invitations.createdAt));
}

// Conditional on status = 'pending' so revoking an already-accepted or
// already-revoked invitation is a clean no-op (0 rows), not an error -
// the caller treats 0 rows as "nothing to revoke."
export async function revokeInvitation(scopedDb: ScopedDb, workspaceId: string, id: string): Promise<boolean> {
  const revoked = await scopedDb
    .update(invitations)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(and(eq(invitations.id, id), eq(invitations.workspaceId, workspaceId), eq(invitations.status, "pending")))
    .returning({ id: invitations.id });
  return revoked.length > 0;
}

// The concurrency-safe half of accept: status = 'pending' AND not
// expired is checked in the same UPDATE, not a separate read-then-write.
// Two simultaneous accept requests race on this single statement - the
// loser affects 0 rows and gets a clean "no longer valid" outcome
// instead of a duplicate user being created.
export async function markInvitationAccepted(scopedDb: ScopedDb, workspaceId: string, id: string) {
  const [invitation] = await scopedDb
    .update(invitations)
    .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(invitations.id, id),
        eq(invitations.workspaceId, workspaceId),
        eq(invitations.status, "pending"),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .returning();
  return invitation ?? null;
}
