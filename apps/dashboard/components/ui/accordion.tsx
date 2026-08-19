"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

// Replaces the widget page's raw <details>/<summary> - same disclosure
// behavior, styled to match the rest of the system instead of the
// browser's native UA styling. The open/close animation is a pure-CSS
// grid-template-rows trick (0fr -> 1fr on a single grid row), so no
// height-measurement JS or animation library is needed.
export function Accordion({
  title,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-elevation-sm">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 p-4 text-left text-sm font-semibold tracking-wide text-slate-500 uppercase"
      >
        {title}
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-slate-200 p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
