"use client";

import { ChevronDown, LogOut, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { type Theme, getEffectiveTheme, setTheme as persistTheme } from "../../lib/theme";

export function UserMenu({
  email,
  secondaryLabel,
  onLogout,
  accentClassName = "bg-brand",
}: {
  email: string;
  secondaryLabel: string;
  onLogout: () => void;
  accentClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  // Starts null (not "light") so the very first client render doesn't
  // briefly claim a theme before lib/theme.ts's own logic has run -
  // matches the anti-flash script in layout.tsx rather than fighting it.
  const [theme, setThemeState] = useState<Theme | null>(null);

  useEffect(() => {
    setThemeState(getEffectiveTheme());
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    persistTheme(next);
    setThemeState(next);
  }

  const initial = email.charAt(0).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100"
      >
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-on-fill",
            accentClassName,
          )}
        >
          {initial}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-[10rem] truncate text-sm font-medium text-slate-900">{email}</span>
          <span className="block text-xs text-slate-500">{secondaryLabel}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-slate-200 bg-white py-1 shadow-elevation-md">
          <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500 sm:hidden">{email}</div>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
