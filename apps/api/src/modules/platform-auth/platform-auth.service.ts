import { findPlatformAdminByEmail } from "@csa/db";
import type { PlatformAdminSession } from "@csa/shared";
import { AuthError } from "../../errors.js";
import { verifyPassword } from "../auth/password.js";
import { signPlatformSessionToken } from "./platform-session-token.js";

export async function platformLogIn(params: { email: string; password: string }) {
  // Same normalize-before-lookup discipline as auth.service.ts's logIn.
  const email = params.email.trim().toLowerCase();

  const admin = await findPlatformAdminByEmail(email);
  if (!admin || admin.status !== "active") {
    throw new AuthError("Invalid credentials.");
  }

  const validPassword = await verifyPassword(admin.passwordHash, params.password);
  if (!validPassword) {
    throw new AuthError("Invalid credentials.");
  }

  const session: PlatformAdminSession = { platformAdminId: admin.id, email: admin.email };
  const token = await signPlatformSessionToken(session);
  return { token, session };
}
