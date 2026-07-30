import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "@csa/shared";
import { env } from "../../config/env.js";

const secret = new TextEncoder().encode(env.SESSION_JWT_SECRET);
const SESSION_DURATION = "7d";

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
