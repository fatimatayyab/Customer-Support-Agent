"use client";

import { BarChart3, BookOpen, Code2, LayoutDashboard, MessageSquare, Plug, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/widget", label: "Widget", icon: Code2 },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/team", label: "Team", icon: Users },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkspaceNavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-3">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function WorkspaceSidebar({
  workspaceName,
  mobileOpen,
  onClose,
}: {
  workspaceName: string;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {/* Desktop: always visible, fixed width, part of the flex layout. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white py-4 md:flex">
        <div className="mb-2 px-4 text-sm font-semibold text-slate-900">{workspaceName}</div>
        <WorkspaceNavLinks />
      </aside>

      {/* Mobile: slide-over drawer behind a backdrop, toggled by the topbar hamburger. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
          <aside className="relative flex h-full w-64 flex-col bg-white py-4 shadow-elevation-md">
            <div className="mb-2 flex items-center justify-between px-4">
              <span className="text-sm font-semibold text-slate-900">{workspaceName}</span>
              <button type="button" onClick={onClose} aria-label="Close menu" className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div onClick={onClose}>
              <WorkspaceNavLinks />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
