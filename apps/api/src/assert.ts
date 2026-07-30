// For invariants the application guarantees itself (e.g. a single-row
// INSERT ... RETURNING), not for validating external input.
export function assertDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}
