import { describe, it, expect } from 'vitest';
import { executeSearchInventory } from '../src/llm/tools.js';
import { MockInventoryClient, foundItem } from './mocks.js';
import type { InventoryClient } from '../src/providers/inventory.js';

const asClient = (m: MockInventoryClient) => m as unknown as InventoryClient;
/** No active holds anywhere. */
const noHolds = async () => 0;

describe('executeSearchInventory — never invents numbers', () => {
  const input = { year: 1995, make: 'Honda', model: 'Accord', part: 'front bumper' };

  it('maps a found item and echoes the exact price back to Claude', async () => {
    const mock = new MockInventoryClient({ status: 'ok', results: [foundItem(129.95, 4)] });
    const res = await executeSearchInventory(asClient(mock), input, noHolds);
    expect(res.lookupResult).toBe('found');
    expect(res.firstPrice).toBe(129.95);
    expect(res.toolResult).toContain('129.95');
  });

  it('reports no_stock when quantities are all zero', async () => {
    const mock = new MockInventoryClient({ status: 'ok', results: [foundItem(129.95, 0)] });
    const res = await executeSearchInventory(asClient(mock), input, noHolds);
    expect(res.lookupResult).toBe('no_stock');
  });

  it('reports not_found on empty results', async () => {
    const mock = new MockInventoryClient({ status: 'ok', results: [] });
    const res = await executeSearchInventory(asClient(mock), input, noHolds);
    expect(res.lookupResult).toBe('not_found');
  });

  it('on api_error returns NO price and an instruction to state no numbers (guardrail)', async () => {
    const mock = new MockInventoryClient({ status: 'api_error', reason: 'timeout (8s)' });
    const res = await executeSearchInventory(asClient(mock), input, noHolds);
    expect(res.lookupResult).toBe('api_error');
    expect(res.firstPrice).toBeNull();
    expect(res.toolResult).toContain('inventory_unavailable');
    expect(res.toolResult).not.toMatch(/\d+\.\d{2}/);
  });
});

describe('Update 001 Rule 2 — effective qty subtracts active holds', () => {
  const input = { year: 1995, make: 'Honda', model: 'Accord', part: 'front bumper' };

  it('subtracts active holds from the quoted quantity', async () => {
    // API says 4; 3 are already on hold → effective 1.
    const mock = new MockInventoryClient({ status: 'ok', results: [foundItem(129.95, 4)] });
    const res = await executeSearchInventory(asClient(mock), input, async () => 3);
    expect(res.firstEffectiveQty).toBe(1);
    expect(res.firstApiQty).toBe(4);
    expect(res.toolResult).toContain('"effective_qty":1');
    // Raw API qty must NOT be exposed in the tool result.
    expect(res.toolResult).not.toContain('"qty":4');
  });

  it('treats a fully-held item as out of stock even if API reports units', async () => {
    // API says 1; 1 already on hold → effective 0 → no_stock.
    const mock = new MockInventoryClient({ status: 'ok', results: [foundItem(129.95, 1)] });
    const res = await executeSearchInventory(asClient(mock), input, async () => 1);
    expect(res.firstEffectiveQty).toBe(0);
    expect(res.lookupResult).toBe('no_stock');
    expect(res.toolResult).toContain('"availability":"out"');
  });

  it('bands availability: 1–2 effective is "low", 3+ is "in_stock"', async () => {
    const lowMock = new MockInventoryClient({ status: 'ok', results: [foundItem(129.95, 2)] });
    const low = await executeSearchInventory(asClient(lowMock), input, noHolds);
    expect(low.toolResult).toContain('"availability":"low"');

    const okMock = new MockInventoryClient({ status: 'ok', results: [foundItem(129.95, 5)] });
    const ok = await executeSearchInventory(asClient(okMock), input, noHolds);
    expect(ok.toolResult).toContain('"availability":"in_stock"');
  });

  it('carries Rule 3 phrasing inline with the data', async () => {
    // Low stock → the tool result itself instructs the "as of right now"
    // qualifier + hold offer, so the rule survives even if the model under-
    // weights the system prompt.
    const lowMock = new MockInventoryClient({ status: 'ok', results: [foundItem(129.95, 1)] });
    const low = await executeSearchInventory(asClient(lowMock), input, noHolds);
    expect(low.toolResult).toContain('as of right now');
    expect(low.toolResult).toMatch(/never say/i);
    expect(low.toolResult).toContain('guaranteed');

    // In-stock still forbids guarantees.
    const okMock = new MockInventoryClient({ status: 'ok', results: [foundItem(129.95, 5)] });
    const ok = await executeSearchInventory(asClient(okMock), input, noHolds);
    expect(ok.toolResult).toContain('guaranteed');
  });
});
