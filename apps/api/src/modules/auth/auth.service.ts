import { randomUUID } from "node:crypto";
import {
  claimWorkspaceSignupInvite,
  findWorkspaceBySlug,
  findWorkspaceSignupInviteByTokenHash,
  withWorkspaceContext,
} from "@csa/db";
import type { SessionUser } from "@csa/shared";
import { AuthError, NotFoundError } from "../../errors.js";
import { getUserByEmail, insertUser } from "../users/user.repository.js";
import { getWorkspaceById, insertWorkspace } from "../workspaces/workspace.repository.js";
import { hashPassword, verifyPassword } from "./password.js";
import { signSessionToken } from "./session-token.js";
import { slugify, withRandomSuffix } from "./slugify.js";
import { hashSignupInviteToken } from "./signup-invite-token.js";

const MAX_SLUG_ATTEMPTS = 5;
const UNIQUE_VIOLATION = "23505";

export async function signUp(params: {
  workspaceName: string;
  email: string;
  password: string;
  name: string;
  inviteToken: string;
}) {
  // Normalized once, here, so every email this system ever stores is
  // canonical form going forward - the invitation flow relies on this to
  // match against pending invites and existing accounts consistently.
  const email = params.email.trim().toLowerCase();

  // Workspace creation is invite-gated, not open self-serve - see
  // docs/07's "Invite-Only Workspace Signup" entry for why. The lookup
  // below exists purely to produce a specific, honest error message
  // (invalid / expired / already used / wrong email); the actual
  // single-use guarantee is claimWorkspaceSignupInvite's atomic
  // conditional UPDATE further down, not this read.
  const inviteTokenHash = hashSignupInviteToken(params.inviteToken);
  const invite = await findWorkspaceSignupInviteByTokenHash(inviteTokenHash);
  if (!invite) {
    throw new NotFoundError("This signup link is invalid.");
  }
  if (invite.usedAt) {
    throw new NotFoundError("This signup link has already been used.");
  }
  if (invite.expiresAt.getTime() <= Date.now()) {
    throw new NotFoundError("This signup link has expired.");
  }
  if (invite.email !== email) {
    throw new NotFoundError("This signup link is for a different email address.");
  }

  const workspaceId = randomUUID();
  const baseSlug = slugify(params.workspaceName) || "workspace";
  const passwordHash = await hashPassword(params.password);

  // The real guard: claims the invite atomically, so two concurrent
  // signups holding the same token can't both pass the checks above and
  // both create a workspace. Whichever request's UPDATE actually flips
  // used_at wins; the other gets this same "no longer valid" rejection a
  // completely stale token would - no way to tell the two apart from the
  // response, and no need to (see claimWorkspaceSignupInvite's comment).
  const claimed = await claimWorkspaceSignupInvite(inviteTokenHash);
  if (!claimed) {
    throw new NotFoundError("This signup link is no longer valid.");
  }

  let attemptSlug = baseSlug;

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    try {
      return await withWorkspaceContext(workspaceId, async (scopedDb) => {
        const workspace = await insertWorkspace(scopedDb, {
          id: workspaceId,
          name: params.workspaceName,
          slug: attemptSlug,
        });
        const user = await insertUser(scopedDb, {
          workspaceId,
          email,
          passwordHash,
          name: params.name,
          role: "owner",
        });
        const session: SessionUser = { userId: user.id, workspaceId, role: user.role, email: user.email };
        const token = await signSessionToken(session);
        return { token, session, workspace };
      });
    } catch (error) {
      if (isUniqueSlugViolation(error) && attempt < MAX_SLUG_ATTEMPTS - 1) {
        attemptSlug = withRandomSuffix(baseSlug);
        continue;
      }
      throw error;
    }
  }

  throw new AuthError("Could not allocate a unique workspace slug.");
}

export async function logIn(params: { workspaceSlug: string; email: string; password: string }) {
  const workspace = await findWorkspaceBySlug(params.workspaceSlug);
  if (!workspace || workspace.status !== "active") {
    throw new AuthError("Invalid credentials.");
  }

  return withWorkspaceContext(workspace.id, async (scopedDb) => {
    // Case-insensitive match against normalized storage - defends
    // against any pre-existing mixed-case rows too, not just new ones.
    const user = await getUserByEmail(scopedDb, workspace.id, params.email.trim().toLowerCase());
    if (!user || user.status !== "active") {
      throw new AuthError("Invalid credentials.");
    }

    const validPassword = await verifyPassword(user.passwordHash, params.password);
    if (!validPassword) {
      throw new AuthError("Invalid credentials.");
    }

    const session: SessionUser = { userId: user.id, workspaceId: workspace.id, role: user.role, email: user.email };
    const token = await signSessionToken(session);
    return { token, session };
  });
}

export async function getSessionWorkspace(session: SessionUser) {
  return withWorkspaceContext(session.workspaceId, (scopedDb) => getWorkspaceById(scopedDb, session.workspaceId));
}

// Drizzle wraps the raw pg driver error in a DrizzleQueryError - the
// real `code` lives on `.cause`, not the top-level error. Found and
// fixed alongside the identical bug in invitation.service.ts's
// isUniqueViolation: this check never actually matched a real slug
// collision, so the retry-with-a-random-suffix logic above was silently
// dead code, not a working safety net.
function isUniqueSlugViolation(error: unknown): boolean {
  return hasPgErrorCode(error, UNIQUE_VIOLATION) || hasPgErrorCode((error as { cause?: unknown })?.cause, UNIQUE_VIOLATION);
}

function hasPgErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === code;
}
