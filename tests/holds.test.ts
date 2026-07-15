import { describe, it, expect } from 'vitest';
import { computeHoldExpiry } from '../src/jobs/holdTime.js';

/**
 * Hold expiry must land at 6 PM shop-local time (America/Los_Angeles),
 * correctly across DST (R-16). Naive UTC-offset math is the classic bug.
 */
describe('computeHoldExpiry — 6 PM Oakland across DST', () => {
  it('resolves 6 PM PDT (summer) to the correct UTC instant', () => {
    // 2026-07-05 is PDT (UTC-7). 6 PM PDT = 01:00 UTC next day.
    const now = new Date('2026-07-05T20:00:00Z'); // 1 PM PDT
    const expiry = computeHoldExpiry(now, 'America/Los_Angeles', 18);
    expect(expiry.toISOString()).toBe('2026-07-06T01:00:00.000Z');
  });

  it('resolves 6 PM PST (winter) to the correct UTC instant', () => {
    // 2026-01-15 is PST (UTC-8). 6 PM PST = 02:00 UTC next day.
    const now = new Date('2026-01-15T20:00:00Z'); // 12 PM PST
    const expiry = computeHoldExpiry(now, 'America/Los_Angeles', 18);
    expect(expiry.toISOString()).toBe('2026-01-16T02:00:00.000Z');
  });

  it('is same-day when now is before 6 PM local', () => {
    const now = new Date('2026-07-05T18:00:00Z'); // 11 AM PDT
    const expiry = computeHoldExpiry(now, 'America/Los_Angeles', 18);
    expect(expiry.getUTCDate()).toBe(6); // 2026-07-06 01:00Z
  });
});
