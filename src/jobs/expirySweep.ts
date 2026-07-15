import type { Store } from '../db/store.js';

/**
 * Pure sweep logic, separated from the cron loop so it is unit-testable.
 */
export async function runExpirySweep(
  store: Store,
  now: Date,
): Promise<{ holdsExpired: number; conversationsClosed: number }> {
  const holdsExpired = await store.expireHolds(now);
  const conversationsClosed = await store.closeExpiredConversations(now);
  return { holdsExpired, conversationsClosed };
}
