import { withWorkspaceContext } from "@csa/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, NotFoundError } from "../../errors.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { requireSession } from "../auth/require-session.js";
import { checkRateLimit } from "../../rate-limit.js";
import { redisClient } from "../../redis-client.js";
import { getUserById, listUsersForWorkspace, updateUserName, updateUserPassword } from "./user.repository.js";

const updateMeSchema = z.object({
  name: z.string().min(1).max(100),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

// Per-user (not per-IP or per-workspace): the thing being protected is
// one account's password being brute-forced, so a single authenticated
// user's attempts are the right unit. Same INCR/EXPIRE primitive as the
// login-attempt limiter in auth.routes.ts.
const PASSWORD_CHANGE_MAX = 10;
const PASSWORD_CHANGE_WINDOW_SECONDS = 60 * 60;

// The account-settings surface. Only ever returns the current,
// authenticated user's own profile - never password_hash, never another
// member's row. Editing a different member's role or removing a member
// is explicitly out of scope (deferred team-management work).
export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);

  app.get("/workspaces/users", async (request, reply) => {
    const users = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      listUsersForWorkspace(scopedDb, request.workspaceId!),
    );
    reply.send({ users });
  });

  app.get("/workspaces/me", async (request, reply) => {
    const user = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      getUserById(scopedDb, request.workspaceId!, request.sessionUser!.userId),
    );
    if (!user) {
      throw new NotFoundError("User not found.");
    }
    reply.send({ user: toPublicUser(user) });
  });

  app.patch("/workspaces/me", async (request, reply) => {
    const body = updateMeSchema.parse(request.body);
    await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      updateUserName(scopedDb, request.workspaceId!, request.sessionUser!.userId, body.name),
    );
    const user = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      getUserById(scopedDb, request.workspaceId!, request.sessionUser!.userId),
    );
    reply.send({ user: user ? toPublicUser(user) : null });
  });

  app.post("/workspaces/me/password", async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    await checkRateLimit(
      redisClient,
      `rl:password-change:${request.sessionUser!.userId}`,
      PASSWORD_CHANGE_MAX,
      PASSWORD_CHANGE_WINDOW_SECONDS,
    );

    const user = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      getUserById(scopedDb, request.workspaceId!, request.sessionUser!.userId),
    );
    if (!user) {
      throw new NotFoundError("User not found.");
    }
    // Verify the existing password before replacing it - same verifyPassword
    // call logIn uses, so a wrong current password is rejected before any
    // write. A specific message is safe here (the caller is already
    // authenticated as this user; it's not an enumeration signal).
    const currentPasswordValid = await verifyPassword(user.passwordHash, body.currentPassword);
    if (!currentPasswordValid) {
      throw new AuthError("Current password is incorrect.");
    }
    const newPasswordHash = await hashPassword(body.newPassword);
    await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      updateUserPassword(scopedDb, request.workspaceId!, request.sessionUser!.userId, newPasswordHash),
    );
    reply.code(204).send();
  });
}

// The only shape the account-settings endpoints ever expose - explicit
// field selection rather than spreading the row, so passwordHash (or a
// future sensitive column) can't leak into a route response by accident.
function toPublicUser(user: {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status };
}
