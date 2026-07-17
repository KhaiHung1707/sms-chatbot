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

  // Regression (bug C2): a hold placed AFTER 6 PM local must roll to 6 PM the
  // NEXT day, never a timestamp in the past. Before the fix, an evening hold got
  // an already-expired timestamp → it reserved nothing → double-booking.
  it('rolls to next day when now is already past 6 PM local', () => {
    // 2026-07-06 04:00Z = 2026-07-05 21:00 PDT (9 PM, past 6 PM).
    const now = new Date('2026-07-06T04:00:00Z');
    const expiry = computeHoldExpiry(now, 'America/Los_Angeles', 18);
    // Must be in the future, and land at 6 PM PDT on 2026-07-06 = 2026-07-07 01:00Z.
    expect(expiry.getTime()).toBeGreaterThan(now.getTime());
    expect(expiry.toISOString()).toBe('2026-07-07T01:00:00.000Z');
  });

  it('rolls forward exactly at the 6 PM boundary', () => {
    // Exactly 6 PM PDT: 2026-07-06 01:00Z. Since expiry <= now, roll to next day.
    const now = new Date('2026-07-06T01:00:00Z');
    const expiry = computeHoldExpiry(now, 'America/Los_Angeles', 18);
    expect(expiry.getTime()).toBeGreaterThan(now.getTime());
  });
});
