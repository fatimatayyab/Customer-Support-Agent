"use client";

import { Menu } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useSession } from "../../lib/session-context";
import { UserMenu } from "./user-menu";
import { WorkspaceSidebar } from "./workspace-sidebar";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  administrator: "Administrator",
  support_agent: "Support Agent",
};

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { user, workspace, logout } = useSession();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <WorkspaceSidebar
        workspaceName={workspace.name}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 md:justify-end md:px-6">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            className="text-slate-500 hover:text-slate-700 md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <UserMenu email={user.email} secondaryLabel={ROLE_LABELS[user.role] ?? user.role} onLogout={logout} />
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
