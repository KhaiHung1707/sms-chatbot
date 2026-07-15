import { createHmac } from 'node:crypto';
import type { InventorySearchOutcome, InventoryItem } from '../src/providers/inventory.js';

/**
 * Test mocks for Quo + Inventory API so the whole flow runs offline.
 */

/**
 * Build a valid Quo signature header for a given raw body, so signature
 * verification can be tested without the real service.
 */
export function signQuoBody(rawBody: string, base64Secret: string, timestamp = '1700000000000'): string {
  const key = Buffer.from(base64Secret, 'base64');
  const digest = createHmac('sha256', key).update(`${timestamp}.${rawBody}`).digest('base64');
  return `hmac;1;${timestamp};${digest}`;
}

/** A base64 secret usable in tests. */
export const TEST_WEBHOOK_SECRET = Buffer.from('test-signing-key').toString('base64');

/** Build a minimal inbound `message.received` webhook body. */
export function inboundWebhookBody(overrides: Partial<{
  id: string;
  from: string;
  to: string;
  body: string;
  direction: 'incoming' | 'outgoing';
  media: { url: string; type: string }[];
  userId: string | null;
}> = {}): string {
  return JSON.stringify({
    type: 'message.received',
    data: {
      object: {
        id: overrides.id ?? 'ACtest123',
        object: 'message',
        from: overrides.from ?? '+15105551234',
        to: overrides.to ?? '+15104512800',
        direction: overrides.direction ?? 'incoming',
        body: overrides.body ?? 'Hi',
        media: overrides.media ?? [],
        userId: overrides.userId ?? null,
      },
    },
  });
}

/** A configurable fake InventoryClient (duck-typed to the real one). */
export class MockInventoryClient {
  constructor(private outcome: InventorySearchOutcome) {}
  setOutcome(outcome: InventorySearchOutcome): void {
    this.outcome = outcome;
  }
  async search(): Promise<InventorySearchOutcome> {
    return this.outcome;
  }
}

export function foundItem(price: number, qty: number): InventoryItem {
  return {
    product_id: 48213,
    sku: 'HO1000123',
    title: 'Front Bumper Cover — 1995-97 Honda Accord',
    price,
    variants: ['black', 'primed', 'painted'],
    inventory: [
      { warehouse: 'US', qty },
      { warehouse: 'CA', qty: 0 },
    ],
  };
}
