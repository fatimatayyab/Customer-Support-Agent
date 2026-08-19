import { describe, expect, it } from "vitest";
import { reconnectDelayMs } from "./ws-client.js";

// Mirrors ws-client.ts's own BASE_RECONNECT_DELAY_MS/MAX_RECONNECT_DELAY_MS/
// JITTER_RATIO constants (not exported - this is the one place their exact
// values matter outside the module itself, so duplicating them here as
// literals is more honest than re-exporting internals just for a test).
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const JITTER_RATIO = 0.2;

function expectedRange(baseDelay: number): [number, number] {
  const jitter = baseDelay * JITTER_RATIO;
  return [Math.max(0, baseDelay - jitter), baseDelay + jitter];
}

// Jitter makes a single call non-deterministic - sampling many times and
// checking every result stays in bounds is the reliable way to test this
// without flaking on an unlucky random draw.
function sampleMany(attempt: number, count = 200): number[] {
  return Array.from({ length: count }, () => reconnectDelayMs(attempt));
}

describe("reconnectDelayMs", () => {
  it("starts near the base delay on the first attempt", () => {
    const [min, max] = expectedRange(BASE_DELAY_MS);
    for (const delay of sampleMany(0)) {
      expect(delay).toBeGreaterThanOrEqual(min);
      expect(delay).toBeLessThanOrEqual(max);
    }
  });

  it("grows exponentially with the attempt number, before capping", () => {
    const [min1, max1] = expectedRange(BASE_DELAY_MS * 2 ** 1);
    for (const delay of sampleMany(1)) {
      expect(delay).toBeGreaterThanOrEqual(min1);
      expect(delay).toBeLessThanOrEqual(max1);
    }

    const [min4, max4] = expectedRange(BASE_DELAY_MS * 2 ** 4);
    for (const delay of sampleMany(4)) {
      expect(delay).toBeGreaterThanOrEqual(min4);
      expect(delay).toBeLessThanOrEqual(max4);
    }
  });

  it("caps at the maximum delay once the exponential backoff exceeds it", () => {
    const [min, max] = expectedRange(MAX_DELAY_MS);
    // 2^5 * 1000 = 32000, already past MAX_DELAY_MS.
    for (const delay of sampleMany(5)) {
      expect(delay).toBeGreaterThanOrEqual(min);
      expect(delay).toBeLessThanOrEqual(max);
    }
  });

  it("stays capped for very large attempt numbers - never grows unbounded", () => {
    const [min, max] = expectedRange(MAX_DELAY_MS);
    // A widget that's been offline a long time shouldn't wait longer and
    // longer between attempts, and the attempt counter itself must never
    // produce a delay that overflows or grows without limit.
    for (const delay of sampleMany(50)) {
      expect(delay).toBeGreaterThanOrEqual(min);
      expect(delay).toBeLessThanOrEqual(max);
    }
  });

  it("never returns a negative delay", () => {
    for (const attempt of [0, 1, 5, 20]) {
      for (const delay of sampleMany(attempt, 50)) {
        expect(delay).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("returns whole milliseconds", () => {
    for (const delay of sampleMany(2, 50)) {
      expect(Number.isInteger(delay)).toBe(true);
    }
  });
});
