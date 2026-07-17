/**
 * DST-correct hold expiry computation (R-16).
 *
 * A hold expires at HOLD_EXPIRY_HOUR (e.g. 18 = 6 PM) shop-local time on the
 * current shop-local day. We must NOT add a fixed UTC offset — that breaks
 * across the PST/PDT boundary. Instead we read the shop-local wall-clock via
 * Intl and compute the exact UTC instant.
 */

/**
 * Return the UTC Date at which a hold created at `now` should expire:
 * `expiryHour` local time in `timeZone`, on the current shop-local day — or the
 * NEXT day if `now` is already past that hour. A hold must never be created with
 * an expiry in the past: a customer confirming a hold at 11 PM should get it held
 * until 6 PM TOMORROW, otherwise the hold is dead on arrival (getActiveHoldQty
 * filters out already-expired holds → the item stays sellable → double-booking).
 */
export function computeHoldExpiry(now: Date, timeZone: string, expiryHour: number): Date {
  const local = getLocalParts(now, timeZone);
  let expiry = zonedWallClockToUtc(
    { year: local.year, month: local.month, day: local.day, hour: expiryHour, minute: 0, second: 0 },
    timeZone,
  );
  // Past today's cutoff → roll to the same hour on the next shop-local day.
  if (expiry.getTime() <= now.getTime()) {
    const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nl = getLocalParts(nextDay, timeZone);
    expiry = zonedWallClockToUtc(
      { year: nl.year, month: nl.month, day: nl.day, hour: expiryHour, minute: 0, second: 0 },
      timeZone,
    );
  }
  return expiry;
}

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getLocalParts(date: Date, timeZone: string): WallClock {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Convert a wall-clock time in `timeZone` to the exact UTC instant.
 * Works by computing the zone's offset at that instant and correcting for it.
 */
function zonedWallClockToUtc(wc: WallClock, timeZone: string): Date {
  // First guess: interpret the wall clock as if it were UTC.
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  // Find what that instant looks like in the target zone, and measure the drift.
  const local = getLocalParts(new Date(asUtc), timeZone);
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const offsetMs = localAsUtc - asUtc;
  return new Date(asUtc - offsetMs);
}
