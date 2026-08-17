import { SignJWT, jwtVerify } from "jose";
import type { FastifyReply } from "fastify";
import type { PlatformAdminSession } from "@csa/shared";
import { env } from "../../config/env.js";

// A completely separate secret from session-token.ts's SESSION_JWT_SECRET
// - a platform-admin session and a workspace session must never verify
// against each other, even if one secret were somehow guessed/leaked.
const secret = new TextEncoder().encode(env.PLATFORM_SESSION_JWT_SECRET);
const SESSION_DURATION = "12h";
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;

export async function signPlatformSessionToken(session: PlatformAdminSession): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secret);
}

export async function verifyPlatformSessionToken(token: string): Promise<PlatformAdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as PlatformAdminSession;
  } catch {
    return null;
  }
}

// A distinct cookie name from SESSION_COOKIE_NAME - both cookies can be
// present on the same browser/origin at once (someone could be logged
// into a workspace and the platform panel simultaneously), so each
// preHandler must only ever look for its own named cookie, never infer
// identity from whichever session happens to be present.
export const PLATFORM_SESSION_COOKIE_NAME = "csa_platform_session";

// Shorter-lived than a workspace session (12h vs 7d) - a platform-admin
// credential can suspend/provision any client, so a narrower window if a
// device is lost/shared is the right tradeoff for this identity, even
// though (like the workspace session) it still can't be force-revoked
// before expiry.
export function setPlatformSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(PLATFORM_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}
