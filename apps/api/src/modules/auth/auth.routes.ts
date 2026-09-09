import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { redisClient } from "../../redis-client.js";
import { checkRateLimit } from "../../rate-limit.js";
import { getSessionWorkspace, logIn, signUp } from "./auth.service.js";
import { getPasswordResetPreview, requestPasswordReset, resetPassword } from "./password-reset.service.js";
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

const forgotPasswordSchema = z.object({
  workspaceSlug: z.string().min(1),
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
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

// Per-email+workspace counter on top of the IP-keyed plugin limit below,
// same shape as LOGIN_ATTEMPT_*: tightens the envelope so a targeted
// script can't hammer one address. The endpoint always responds 202
// regardless, so the rate limit's job is cost/abuse protection, not
// enumeration prevention.
const FORGOT_PASSWORD_ATTEMPT_MAX = 5;
const FORGOT_PASSWORD_ATTEMPT_WINDOW_SECONDS = 600;

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

  // Public (no session) - must NOT reveal whether an account exists, so it
  // always responds 202 with the same shape whether or not a reset email
  // was actually sent. IP-keyed plugin limit + per-email counter below.
  app.post("/auth/forgot-password", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const body = forgotPasswordSchema.parse(request.body);
    await checkRateLimit(
      redisClient,
      `rl:forgot-password:${body.workspaceSlug}:${body.email.toLowerCase()}`,
      FORGOT_PASSWORD_ATTEMPT_MAX,
      FORGOT_PASSWORD_ATTEMPT_WINDOW_SECONDS,
    );
    await requestPasswordReset(body.workspaceSlug, body.email);
    // Operational visibility only - deliberately no email/token content.
    request.log.info({ workspaceSlug: body.workspaceSlug }, "password reset requested");
    reply.code(202).send();
  });

  // Public reset surface used by the standalone /reset-password page.
  app.get("/reset-password", async (request, reply) => {
    const query = z.object({ token: z.string().min(1) }).parse(request.query);
    const preview = await getPasswordResetPreview(query.token);
    reply.send({ email: preview.email });
  });

  app.post("/reset-password", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);
    await resetPassword(body.token, body.newPassword);
    reply.code(204).send();
  });
}
