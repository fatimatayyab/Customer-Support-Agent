type ClassValue = string | number | null | undefined | false;

// Deliberately not clsx/tailwind-merge - string joining is all every
// call site here needs, and it keeps the primitive layer dependency-free.
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
