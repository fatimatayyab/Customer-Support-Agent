"use client";

import { createContext, useContext, useId, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  idPrefix: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> must be used inside <Tabs>`);
  return ctx;
}

interface TabsProps {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: ReactNode;
}

// Hand-rolled rather than a Radix dependency - the interaction surface
// (click a trigger, show its panel) doesn't need more than a context +
// two small components. Supports both controlled (value/onValueChange)
// and uncontrolled (defaultValue only) use.
export function Tabs({ defaultValue, value, onValueChange, className, children }: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const idPrefix = useId();
  const active = value ?? internalValue;

  function setValue(next: string) {
    if (onValueChange) {
      onValueChange(next);
    } else {
      setInternalValue(next);
    }
  }

  return (
    <TabsContext.Provider value={{ value: active, setValue, idPrefix }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div role="tablist" className={cn("flex items-center gap-1 border-b border-slate-200", className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useTabsContext("TabsTrigger");
  const isActive = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.idPrefix}-tab-${value}`}
      aria-selected={isActive}
      aria-controls={`${ctx.idPrefix}-panel-${value}`}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        isActive ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700",
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  const ctx = useTabsContext("TabsContent");
  if (ctx.value !== value) return null;
  return (
    <div role="tabpanel" id={`${ctx.idPrefix}-panel-${value}`} aria-labelledby={`${ctx.idPrefix}-tab-${value}`} className={className}>
      {children}
    </div>
  );
}
