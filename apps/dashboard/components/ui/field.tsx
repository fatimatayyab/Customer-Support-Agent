import { forwardRef } from "react";
import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const CONTROL_CLASS =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none " +
  "placeholder:text-slate-400 focus:border-slate-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60";

const INVALID_CLASS = "border-red-300 focus:border-red-500";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL_CLASS, invalid && INVALID_CLASS, className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...props }, ref) {
  return <textarea ref={ref} className={cn(CONTROL_CLASS, invalid && INVALID_CLASS, className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={cn(CONTROL_CLASS, "cursor-pointer", className)} {...props} />;
});

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

// Replaces the three independently-drifting `Field` copies that existed
// on login/signup/platform-login (one supported minLength, one didn't
// support placeholder, etc.) with a single implementation every form
// shares. The label wraps its control (implicit association, same as
// the original pages) rather than pairing via id/htmlFor - one less
// thing for a caller to wire up correctly.
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-sm", className)}>
      <span className="font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-slate-700", className)} {...props} />;
}
