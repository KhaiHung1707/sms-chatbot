import type {
  InventorySearchParams,
  InventorySearchOutcome,
  InventoryItem,
} from '../providers/inventory.js';

/**
 * Fake in-memory catalog for local dev — no WordPress, no HTTP. A handful of
 * SKUs with different quantities so you can exercise every availability band
 * (in_stock / low / out) and the effective-qty logic (Update 001).
 *
 * Matching is lowercase substring on make/model/part, mirroring how the real
 * plugin normalizes. Not exhaustive — just enough to drive the flow.
 */
const CATALOG: Array<InventoryItem & { year: number; make: string; model: string; part: string }> = [
  {
    year: 1995, make: 'honda', model: 'accord', part: 'front bumper',
    product_id: 48213, sku: 'HO1000123',
    title: 'Front Bumper Cover — 1995-97 Honda Accord',
    price: 129.95, variants: ['black', 'primed', 'painted'],
    inventory: [{ warehouse: 'US', qty: 4 }], // in_stock
  },
  {
    year: 1998, make: 'honda', model: 'civic', part: 'left mirror',
    product_id: 48990, sku: 'HO1000550',
    title: 'Left Side Mirror — 1996-00 Honda Civic',
    price: 42.5, variants: [],
    inventory: [{ warehouse: 'US', qty: 1 }], // low
  },
  {
    year: 2005, make: 'toyota', model: 'camry', part: 'tail light',
    product_id: 51002, sku: 'TO2000777',
    title: 'Tail Light Assembly — 2002-06 Toyota Camry',
    price: 88.0, variants: [],
    inventory: [{ warehouse: 'US', qty: 0 }], // out
  },
];

export class FakeInventory {
  async search(params: InventorySearchParams): Promise<InventorySearchOutcome> {
    const make = params.make.toLowerCase().trim();
    const model = params.model.toLowerCase().trim();
    const part = params.part.toLowerCase().trim();

    const results = CATALOG.filter(
      (item) =>
        item.year === params.year &&
        item.make === make &&
        item.model === model &&
        item.part === part,
    ).map(({ year: _y, make: _mk, model: _md, part: _p, ...item }) => item);

    return { status: 'ok', results };
  }

  /** For the dev banner: list what's searchable. */
  static describe(): string {
    return CATALOG.map(
      (c) => `  • ${c.year} ${c.make} ${c.model} — ${c.part} ($${c.price}, qty ${c.inventory[0]!.qty})`,
    ).join('\n');
  }
}
