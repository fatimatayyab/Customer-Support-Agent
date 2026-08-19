import type { PlatformAdminSession, SessionUser } from "@csa/shared";
import { cookies } from "next/headers";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

// Deliberately a plain string literal, not imported from @csa/shared -
// this file is the dashboard's first genuine RUNTIME (non-type-only)
// use of that package, and Next's bundler can't resolve @csa/shared's
// .js-suffixed internal imports (packages/shared/src/index.ts) the way
// tsx does for apps/api; importing a real value from it here breaks the
// dev build ("Module not found: Can't resolve './roles.js'"). Must stay
// in sync with SESSION_COOKIE_NAME in apps/api/src/modules/auth/session-token.ts.
const SESSION_COOKIE_NAME = "csa_session";
// Must stay in sync with PLATFORM_SESSION_COOKIE_NAME in
// apps/api/src/modules/platform-auth/platform-session-token.ts.
const PLATFORM_SESSION_COOKIE_NAME = "csa_platform_session";

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

export interface WorkspaceSessionData {
  user: SessionUser;
  workspace: Workspace;
}

// Root cause of Phase 1's widget double-provisioning bug: the
// (workspace) layout used to render nothing but a client-only
// WorkspaceSessionProvider that fetched /auth/me in a useEffect and
// swapped a skeleton for the real page once it resolved. That made every
// page's real content mount purely on the client, after hydration - the
// exact shape React's dev-mode Strict Mode double-invokes to catch
// effects that aren't safe to run twice, which is exactly what the
// widget page's auto-provision effect was. Resolving the session
// SERVER-SIDE (same /auth/me the client used to call, just with the
// cookie forwarded manually) lets the layout render real content on the
// very first pass, the same way the pre-Phase-1 top-level page.tsx files
// did - no purely-client-only mount, no double-invoke exposure.
export async function getWorkspaceSession(): Promise<WorkspaceSessionData | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const response = await fetch(`${API_URL}/auth/me`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as WorkspaceSessionData;
  } catch {
    return null;
  }
}

export async function getPlatformSession(): Promise<PlatformAdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const response = await fetch(`${API_URL}/platform/me`, {
      headers: { Cookie: `${PLATFORM_SESSION_COOKIE_NAME}=${token}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { platformAdmin: PlatformAdminSession };
    return data.platformAdmin;
  } catch {
    return null;
  }
}
