import { randomUUID } from "node:crypto";
import { findWorkspaceBySlug, withWorkspaceContext } from "@csa/db";
import type { SessionUser } from "@csa/shared";
import { AuthError } from "../../errors.js";
import { getUserByEmail, insertUser } from "../users/user.repository.js";
import { getWorkspaceById, insertWorkspace } from "../workspaces/workspace.repository.js";
import { hashPassword, verifyPassword } from "./password.js";
import { signSessionToken } from "./session-token.js";
import { slugify, withRandomSuffix } from "./slugify.js";

const MAX_SLUG_ATTEMPTS = 5;
const UNIQUE_VIOLATION = "23505";

export async function signUp(params: { workspaceName: string; email: string; password: string; name: string }) {
  const workspaceId = randomUUID();
  const baseSlug = slugify(params.workspaceName) || "workspace";
  const passwordHash = await hashPassword(params.password);
  // Normalized once, here, so every email this system ever stores is
  // canonical form going forward - the invitation flow relies on this to
  // match against pending invites and existing accounts consistently.
  const email = params.email.trim().toLowerCase();

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
