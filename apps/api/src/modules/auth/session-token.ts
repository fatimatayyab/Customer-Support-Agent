import { SignJWT, jwtVerify } from "jose";
import type { FastifyReply } from "fastify";
import type { SessionUser } from "@csa/shared";
import { env } from "../../config/env.js";

const secret = new TextEncoder().encode(env.SESSION_JWT_SECRET);
const SESSION_DURATION = "7d";
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export async function signSessionToken(session: SessionUser): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = "csa_session";

// Extracted here (not left as a local helper in auth.routes.ts) once the
// invitation accept flow became a second caller that needs to set the
// exact same cookie after signing a session - CLAUDE.md's "wait for the
// second use" applied to this specific helper.
export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}
