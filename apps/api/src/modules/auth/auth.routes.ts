import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { redisClient } from "../../redis-client.js";
import { checkRateLimit } from "../../rate-limit.js";
import { getSessionWorkspace, logIn, signUp } from "./auth.service.js";
import { requireSession } from "./require-session.js";
import { SESSION_COOKIE_NAME, setSessionCookie } from "./session-token.js";

const signUpSchema = z.object({
  workspaceName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100),
  // Workspace creation is invite-gated (docs/07's "Invite-Only Workspace
  // Signup" entry) - required, not optional, at the schema level.
  inviteToken: z.string().min(1),
});

const logInSchema = z.object({
  workspaceSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

// IP-keyed (the plugin's default) - there's no workspace context yet at
// signup, and login identifies a workspace by slug in the body, not
// something available to key on before the handler runs. Tight enough
// to blunt credential-stuffing/signup-spam without punishing a genuine
// user who mistypes a password a few times.
const AUTH_RATE_LIMIT = { max: 10, timeWindow: "10 minutes" };

// The plugin-level limit above is IP-keyed, which a distributed attacker
// can trivially route around by rotating IPs against one known
// workspace+email. This is a second, per-account counter on top of it -
// tighter (5, not 10) since it's scoped to a single target rather than
// shared across every login attempt from one IP. Keyed on
// workspaceSlug+email together, not email alone: the same email could be
// a legitimate user in one workspace and a stuffing target in another,
// and they shouldn't share a counter.
const LOGIN_ATTEMPT_MAX = 5;
const LOGIN_ATTEMPT_WINDOW_SECONDS = 600;

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/signup", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const body = signUpSchema.parse(request.body);
    const { token, session, workspace } = await signUp(body);
    setSessionCookie(reply, token);
    reply.code(201).send({ user: session, workspace });
  });

  app.post("/auth/login", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const body = logInSchema.parse(request.body);
    await checkRateLimit(
      redisClient,
      `rl:login-attempt:${body.workspaceSlug}:${body.email.toLowerCase()}`,
      LOGIN_ATTEMPT_MAX,
      LOGIN_ATTEMPT_WINDOW_SECONDS,
    );
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
