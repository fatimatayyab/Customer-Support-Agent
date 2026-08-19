"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePlatformSession } from "../../lib/session-context";
import { UserMenu } from "./user-menu";

// Deliberately top-bar-only, not a mirrored sidebar - the platform side
// has exactly one real top-level section (Workspaces) today, so a
// sidebar would be chrome without content. The violet accent (vs. the
// workspace shell's brand slate) is the one deliberate visual divergence
// between the two shells - everything else (primitives, tokens, layout
// rhythm) is shared, so a screenshot reads as "same product, internal
// surface" rather than a different app.
export function PlatformShell({ children }: { children: ReactNode }) {
  const { admin, logout } = usePlatformSession();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/platform" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-platform text-white">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold text-slate-900">Platform</span>
          </Link>
          <UserMenu email={admin.email} secondaryLabel="Platform admin" onLogout={logout} accentClassName="bg-accent-platform" />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
