import { describe, it, expect } from 'vitest';
import { MemoryStore } from './memoryStore.js';

/**
 * Update 001 Rule 2 acceptance criteria — effective availability and the
 * atomic hold prevent promising the same last unit twice.
 */
describe('Update 001 — never promise the last unit twice', () => {
  async function seedLookup(store: MemoryStore, wcProductId: number) {
    const customer = await store.createCustomer('+15105550100');
    const conv = await store.createConversation(customer.id, new Date(Date.now() + 3_600_000));
    return store.recordLookup({
      conversationId: conv.id, year: 1995, make: 'honda', model: 'accord',
      partType: 'front bumper', wcProductId, priceSnapshot: 129.95, warehouse: 'US',
      effectiveQty: 1, result: 'found',
    });
  }

  it('with qty=1 and one active hold, the second customer is told it is unavailable', async () => {
    const store = new MemoryStore();
    const lookup = await seedLookup(store, 48213);
    const expires = new Date(Date.now() + 3_600_000);

    // First customer reserves the only unit.
    const first = await store.createHoldIfAvailable({
      lookupId: lookup.id, wcProductId: 48213, apiQty: 1, qty: 1, expiresAt: expires,
    });
    expect(first).not.toBeNull();

    // Second customer: effective qty is now 0 → getActiveHoldQty confirms it,
    // and a hold attempt is rejected.
    expect(await store.getActiveHoldQty(48213)).toBe(1);
    const second = await store.createHoldIfAvailable({
      lookupId: lookup.id, wcProductId: 48213, apiQty: 1, qty: 1, expiresAt: expires,
    });
    expect(second).toBeNull();
  });

  it('two hold requests for the last unit → exactly one succeeds', async () => {
    const store = new MemoryStore();
    const lookup = await seedLookup(store, 48213);
    const expires = new Date(Date.now() + 3_600_000);

    const [a, b] = await Promise.all([
      store.createHoldIfAvailable({ lookupId: lookup.id, wcProductId: 48213, apiQty: 1, qty: 1, expiresAt: expires }),
      store.createHoldIfAvailable({ lookupId: lookup.id, wcProductId: 48213, apiQty: 1, qty: 1, expiresAt: expires }),
    ]);

    const succeeded = [a, b].filter((h) => h !== null);
    expect(succeeded).toHaveLength(1);
  });

  it('an expired hold frees the unit again', async () => {
    const store = new MemoryStore();
    const lookup = await seedLookup(store, 48213);
    const past = new Date(Date.now() - 60_000);

    await store.createHoldIfAvailable({ lookupId: lookup.id, wcProductId: 48213, apiQty: 1, qty: 1, expiresAt: past });
    // Even BEFORE the expiry cron runs, a lapsed hold must not count against
    // availability (Update 001 Rule 2 hardening — no false "unavailable").
    expect(await store.getActiveHoldQty(48213)).toBe(0);

    // And the cron still cleanly flips its status afterwards.
    await store.expireHolds(new Date());
    expect(await store.getActiveHoldQty(48213)).toBe(0);
  });

  it('a lapsed hold does not block a new hold for the same last unit', async () => {
    const store = new MemoryStore();
    const lookup = await seedLookup(store, 48213);
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);

    // Old hold has lapsed (not yet swept). A new customer should still be able
    // to reserve the unit — the lapsed hold no longer counts.
    await store.createHoldIfAvailable({ lookupId: lookup.id, wcProductId: 48213, apiQty: 1, qty: 1, expiresAt: past });
    const fresh = await store.createHoldIfAvailable({
      lookupId: lookup.id, wcProductId: 48213, apiQty: 1, qty: 1, expiresAt: future,
    });
    expect(fresh).not.toBeNull();
  });
});
