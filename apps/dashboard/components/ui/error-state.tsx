import { AlertTriangle } from "lucide-react";
import { Button } from "./button";

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-100 bg-red-50 px-6 py-8 text-center">
      <AlertTriangle className="h-6 w-6 text-red-500" strokeWidth={1.5} />
      <p className="text-sm text-red-700">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// Small inline variant for form-level errors, replacing the bare
// `<p className="text-red-600">` scattered across every form - same
// visual weight the pages already used, just centralized.
export function InlineError({ message }: { message: string }) {
  return <p className="text-sm text-red-600">{message}</p>;
}
