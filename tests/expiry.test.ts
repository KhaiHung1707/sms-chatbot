import { describe, it, expect } from 'vitest';
import { runExpirySweep } from '../src/jobs/expirySweep.js';
import { MemoryStore } from './memoryStore.js';

describe('runExpirySweep', () => {
  it('expires active holds past their time and closes expired conversations', async () => {
    const store = new MemoryStore();
    const customer = await store.createCustomer('+15105550009');

    // One expired conversation, one still-open.
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60 * 60_000);
    await store.createConversation(customer.id, past);
    await store.createConversation(customer.id, future);

    // A lookup + two holds: one past-due, one future.
    const lookup = await store.recordLookup({
      conversationId: 'c', year: 1995, make: 'honda', model: 'accord',
      partType: 'front bumper', wcProductId: 1, priceSnapshot: 1, warehouse: 'US',
      effectiveQty: 10, result: 'found',
    });
    await store.createHoldIfAvailable({ lookupId: lookup.id, wcProductId: 1, apiQty: 10, qty: 1, expiresAt: past });
    await store.createHoldIfAvailable({ lookupId: lookup.id, wcProductId: 1, apiQty: 10, qty: 1, expiresAt: future });

    const result = await runExpirySweep(store, new Date());
    expect(result.holdsExpired).toBe(1);
    expect(result.conversationsClosed).toBe(1);

    // Idempotent: a second sweep changes nothing.
    const again = await runExpirySweep(store, new Date());
    expect(again.holdsExpired).toBe(0);
    expect(again.conversationsClosed).toBe(0);
  });
});
