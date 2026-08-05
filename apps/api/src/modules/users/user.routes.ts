import { withWorkspaceContext } from "@csa/db";
import type { FastifyInstance } from "fastify";
import { requireSession } from "../auth/require-session.js";
import { listUsersForWorkspace } from "./user.repository.js";

// Dashboard-facing: session-cookie authenticated, same as workspace.routes.ts.
// Read-only for this milestone - editing a role or removing a member is
// explicitly deferred (see docs/07's notes on this milestone).
export async function userRoutes(app: FastifyInstance) {
  app.get("/workspaces/users", { preHandler: requireSession }, async (request, reply) => {
    const users = await withWorkspaceContext(request.workspaceId!, (scopedDb) =>
      listUsersForWorkspace(scopedDb, request.workspaceId!),
    );
    reply.send({ users });
  });
}
