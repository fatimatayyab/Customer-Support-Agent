// A bare toLocaleTimeString() (e.g. "3:45 PM") is ambiguous once a
// conversation is more than a few hours old - a queue row updated three
// days ago and one updated five minutes ago can show the identical
// string. This adds just enough date context to disambiguate without
// full timestamp verbosity everywhere.
export function formatQueueTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const isSameDay = date.toDateString() === now.toDateString();
  if (isSameDay) return time;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;

  const sameYear = date.getFullYear() === now.getFullYear();
  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  return `${datePart}, ${time}`;
}
