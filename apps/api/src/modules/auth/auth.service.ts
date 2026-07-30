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
          email: params.email,
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
    const user = await getUserByEmail(scopedDb, workspace.id, params.email);
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

function isUniqueSlugViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === UNIQUE_VIOLATION
  );
}
