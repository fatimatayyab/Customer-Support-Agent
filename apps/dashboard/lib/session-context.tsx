"use client";

import type { PlatformAdminSession, SessionUser } from "@csa/shared";
import { useRouter } from "next/navigation";
import { createContext, useContext } from "react";
import type { PropsWithChildren } from "react";
import { apiFetch } from "./api";

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface WorkspaceSessionValue {
  user: SessionUser;
  workspace: Workspace;
  logout: () => Promise<void>;
}

const WorkspaceSessionContext = createContext<WorkspaceSessionValue | null>(null);

// The (workspace) layout resolves the session server-side (see
// lib/session-server.ts) and redirects to /login itself if there isn't
// one - by the time this provider ever renders, initialSession is
// always real data, never null. That's deliberate: an earlier version
// fetched /auth/me in a client useEffect and conditionally rendered
// either a skeleton or {children} depending on whether it had resolved
// yet, which meant every page's real content only ever mounted purely
// on the client, after hydration - exactly the shape React's dev-mode
// Strict Mode double-invokes to catch effects that aren't safe to run
// twice (which the widget page's auto-provision effect wasn't). Always
// rendering children immediately, with real data already in hand,
// removes that purely-client-only mount entirely instead of papering
// over its symptom.
export function WorkspaceSessionProvider({
  children,
  initialSession,
}: PropsWithChildren<{ initialSession: { user: SessionUser; workspace: Workspace } }>) {
  const router = useRouter();

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <WorkspaceSessionContext.Provider value={{ ...initialSession, logout }}>
      {children}
    </WorkspaceSessionContext.Provider>
  );
}

export function useSession(): WorkspaceSessionValue {
  const ctx = useContext(WorkspaceSessionContext);
  if (!ctx) throw new Error("useSession must be used within WorkspaceSessionProvider");
  return ctx;
}

interface PlatformSessionValue {
  admin: PlatformAdminSession;
  logout: () => Promise<void>;
}

const PlatformSessionContext = createContext<PlatformSessionValue | null>(null);

// Same reasoning as WorkspaceSessionProvider above - the platform
// dashboard layout resolves the session server-side and redirects
// itself if there isn't one, so this always receives real data.
export function PlatformSessionProvider({
  children,
  initialAdmin,
}: PropsWithChildren<{ initialAdmin: PlatformAdminSession }>) {
  const router = useRouter();

  async function logout() {
    await apiFetch("/platform/logout", { method: "POST" });
    router.push("/platform/login");
  }

  return (
    <PlatformSessionContext.Provider value={{ admin: initialAdmin, logout }}>
      {children}
    </PlatformSessionContext.Provider>
  );
}

export function usePlatformSession(): PlatformSessionValue {
  const ctx = useContext(PlatformSessionContext);
  if (!ctx) throw new Error("usePlatformSession must be used within PlatformSessionProvider");
  return ctx;
}
