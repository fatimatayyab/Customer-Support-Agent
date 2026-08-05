import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSessionWorkspace, logIn, signUp } from "./auth.service.js";
import { requireSession } from "./require-session.js";
import { SESSION_COOKIE_NAME, setSessionCookie } from "./session-token.js";

const signUpSchema = z.object({
  workspaceName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100),
});

const logInSchema = z.object({
  workspaceSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/signup", async (request, reply) => {
    const body = signUpSchema.parse(request.body);
    const { token, session, workspace } = await signUp(body);
    setSessionCookie(reply, token);
    reply.code(201).send({ user: session, workspace });
  });

  app.post("/auth/login", async (request, reply) => {
    const body = logInSchema.parse(request.body);
    const { token, session } = await logIn(body);
    setSessionCookie(reply, token);
    reply.send({ user: session });
  });

  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    reply.code(204).send();
  });

  app.get("/auth/me", { preHandler: requireSession }, async (request, reply) => {
    const workspace = await getSessionWorkspace(request.sessionUser!);
    reply.send({ user: request.sessionUser, workspace });
  });
}
