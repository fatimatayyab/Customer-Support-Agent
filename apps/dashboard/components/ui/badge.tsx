import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type BadgeTone = "neutral" | "success" | "danger" | "warning" | "info";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  success: "bg-success-subtle text-emerald-700",
  danger: "bg-danger-subtle text-red-700",
  warning: "bg-warning-subtle text-amber-700",
  info: "bg-info-subtle text-blue-700",
};

// The single status-color source of truth - the audit found this same
// tone mapping (emerald/red/amber/blue/slate) reimplemented independently
// on conversation status, knowledge status, integration status, and
// workspace active/suspended pills. Callers only choose a tone, never a
// raw color.
export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
