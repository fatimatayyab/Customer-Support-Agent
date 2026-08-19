import { cn } from "../../lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200/70", className)} />;
}

// Full-page loading placeholder - replaces the `return null` (blank
// white screen) pattern that was on nearly every page while its first
// fetch was in flight. Deliberately generic (a title bar + a few content
// blocks) rather than per-page-shaped, since it's shown for a few hundred
// ms at most.
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <Skeleton className="h-7 w-48" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
