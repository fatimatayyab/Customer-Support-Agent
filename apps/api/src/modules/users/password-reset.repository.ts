import { and, eq, gt, isNull } from "drizzle-orm";
import { passwordResetTokens, type ScopedDb } from "@csa/db";
import { assertDefined } from "../../assert.js";

export async function insertPasswordResetToken(
  scopedDb: ScopedDb,
  workspaceId: string,
  userId: string,
  tokenHash: string,
  expiresAt: Date,
) {
  const [token] = await scopedDb
    .insert(passwordResetTokens)
    .values({ workspaceId, userId, tokenHash, expiresAt })
    .returning();
  return assertDefined(token, "insertPasswordResetToken: INSERT ... RETURNING produced no row.");
}

// The atomic single-use claim - same conditional-UPDATE shape as
// invitations.acceptInvitation and claimWorkspaceSignupInvite: used_at IS
// NULL AND not expired is checked in the same UPDATE, so two simultaneous
// reset attempts race on this one statement - the loser affects 0 rows
// and gets a clean "no longer valid" outcome instead of both succeeding.
// Must run inside withWorkspaceContext(token.workspaceId) (RLS).
export async function claimPasswordResetToken(
  scopedDb: ScopedDb,
  workspaceId: string,
  tokenId: string,
): Promise<{ userId: string } | null> {
  const [token] = await scopedDb
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.id, tokenId),
        eq(passwordResetTokens.workspaceId, workspaceId),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: passwordResetTokens.userId });
  return token ?? null;
}