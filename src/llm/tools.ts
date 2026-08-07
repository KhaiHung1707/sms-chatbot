import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import type { InventoryClient, InventoryItem } from '../providers/inventory.js';

/**
 * Claude tool definitions and their executors.
 *
 * search_inventory is the ONLY source of price/stock numbers. create_hold is
 * only called after explicit customer confirmation (enforced by the prompt).
 */

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'search_inventory',
    description:
      'Look up real price and stock from the catalog. Must be called before stating any number. Only call after the customer has confirmed the vehicle (year, make, model) and the part.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer' },
        make: { type: 'string' },
        model: { type: 'string' },
        part: {
          type: 'string',
          description: 'e.g. front bumper, tail light, left mirror',
        },
      },
      required: ['year', 'make', 'model', 'part'],
    },
  },
  {
    name: 'lookup_sku',
    description:
      'Look up a product directly by its SKU / part number (e.g. "GM1000683", "HO1070157" — 2 letters followed by 6-8 digits). Use this whenever the customer gives a part number instead of a vehicle. Returns the product name, price, stock, feature bullets, vehicle fitment, and order link.',
    input_schema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'the SKU / part number, e.g. GM1000683' },
      },
      required: ['sku'],
    },
  },
  {
    name: 'create_hold',
    description:
      "Hold the part the customer just asked about, until end of day. Call this as soon as the customer confirms they want a hold — you do NOT need a product id; the system holds the most recently found part in this conversation. Do not claim an item is held unless this tool returns held:true.",
    input_schema: {
      type: 'object',
      properties: {
        qty: { type: 'integer', default: 1 },
      },
      required: [],
    },
  },
];

/**
 * Runtime validators for tool input. The Anthropic SDK does NOT enforce a tool's
 * input_schema, so a hallucinated or malformed tool call can arrive with missing
 * or wrong-typed fields. Validating here stops "undefined" params reaching the
 * inventory API (which would falsely report "not found") and blocks nonsensical
 * hold quantities (a negative qty would otherwise always pass the availability
 * check and reserve garbage).
 */
export const searchInventorySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100),
  make: z.string().min(1),
  model: z.string().min(1),
  part: z.string().min(1),
});

export const createHoldSchema = z.object({
  product_id: z.coerce.number().int().positive().optional(),
  qty: z.coerce.number().int().positive().max(50).optional(),
});

// A SKU is 2 letters + 6-8 digits (GM1000683, HO1070157). Case-insensitive.
export const lookupSkuSchema = z.object({
  sku: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}\d{6,8}$/, 'not a valid SKU'),
});

export type SearchInventoryInput = z.infer<typeof searchInventorySchema>;
export type CreateHoldInput = z.infer<typeof createHoldSchema>;
export type LookupSkuInput = z.infer<typeof lookupSkuSchema>;

/**
 * Result of executing search_inventory, shaped for the tool_result block AND
 * for the audit trail (part_lookups). The pipeline records the lookup and
 * feeds `toolResult` back to Claude.
 */
export interface SearchExecution {
  toolResult: string; // JSON string returned to Claude
  lookupResult: 'found' | 'no_stock' | 'not_found' | 'api_error';
  firstProductId: number | null;
  firstPrice: number | null;
  firstWarehouse: string | null;
  /** Effective qty (api − active holds) of the first result, for record/logic. */
  firstEffectiveQty: number | null;
  /** Raw API qty of the first result — needed for the atomic hold check. */
  firstApiQty: number | null;
}

/** Returns the total qty currently on active holds for a Woo product. */
export type ActiveHoldLookup = (wcProductId: number) => Promise<number>;

type AvailabilityBand = 'in_stock' | 'low' | 'out';

/**
 * Availability band for Update 001 Rule 3 phrasing. The stock qty the model
 * sees is ALWAYS the effective qty (api − active holds); the band tells it how
 * to talk about it.
 */
function availabilityBand(effectiveQty: number): AvailabilityBand {
  if (effectiveQty <= 0) return 'out';
  if (effectiveQty <= 2) return 'low';
  return 'in_stock';
}

/**
 * Rule 3 phrasing instruction carried inline with each result, so the honest-
 * stock rule travels with the data (robust even if the model under-weights the
 * system prompt). Never promises availability.
 */
function phrasingFor(band: AvailabilityBand): string {
  switch (band) {
    case 'low':
      return 'Low stock — you MUST say "as of right now" and proactively offer a hold. Never say "guaranteed".';
    case 'out':
      return 'Out of stock. Suggest alternatives only if present here. Never say "guaranteed".';
    case 'in_stock':
      return 'In stock. Never say "guaranteed" or "definitely in stock" — stock can change before pickup.';
  }
}

export async function executeSearchInventory(
  inventory: InventoryClient,
  input: SearchInventoryInput,
  activeHoldQty: ActiveHoldLookup,
): Promise<SearchExecution> {
  const outcome = await inventory.search(input);

  if (outcome.status === 'api_error') {
    return {
      toolResult: JSON.stringify({
        error: 'inventory_unavailable',
        message:
          'The inventory system could not be reached. Do not state any numbers; tell the customer a staff member will follow up.',
      }),
      lookupResult: 'api_error',
      firstProductId: null,
      firstPrice: null,
      firstWarehouse: null,
      firstEffectiveQty: null,
      firstApiQty: null,
    };
  }

  const results = outcome.results;
  if (results.length === 0) {
    return {
      toolResult: JSON.stringify({ results: [] }),
      lookupResult: 'not_found',
      firstProductId: null,
      firstPrice: null,
      firstWarehouse: null,
      firstEffectiveQty: null,
      firstApiQty: null,
    };
  }

  // Update 001 Rule 2: subtract active holds so the model never sees — and so
  // never quotes — a unit that's already reserved for another customer.
  const enriched = await Promise.all(
    results.map((item) => enrichItem(item, activeHoldQty)),
  );

  const first = enriched[0]!;
  const firstApiQty = results[0]!.inventory.reduce((sum, w) => sum + w.qty, 0);
  const inStockWarehouse =
    results[0]!.inventory.find((w) => w.qty > 0)?.warehouse ?? null;

  return {
    toolResult: JSON.stringify({ results: enriched }),
    lookupResult: first.effective_qty > 0 ? 'found' : 'no_stock',
    firstProductId: first.product_id,
    firstPrice: first.price,
    firstWarehouse: inStockWarehouse,
    firstEffectiveQty: first.effective_qty,
    firstApiQty,
  };
}

/**
 * Shared per-item enrichment (Update 001 Rule 2): subtract active holds so the
 * model never sees a reserved unit, and attach the honest-stock band/phrasing.
 * Used by BOTH search_inventory and lookup_sku so a SKU quote also respects holds.
 */
async function enrichItem(item: InventoryItem, activeHoldQty: ActiveHoldLookup) {
  const apiQty = item.inventory.reduce((sum, w) => sum + w.qty, 0);
  const held = await activeHoldQty(item.product_id);
  const effectiveQty = Math.max(0, apiQty - held);
  const band = availabilityBand(effectiveQty);
  return {
    product_id: item.product_id,
    sku: item.sku,
    title: item.title,
    price: item.price,
    variants: item.variants,
    // Feature bullets — now returned by /parts/search too (plugin v1.2.0), so
    // every quote can include a Features list. Empty array when the product has none.
    features: item.features,
    permalink: item.permalink,
    effective_qty: effectiveQty,
    availability: band,
    phrasing: phrasingFor(band),
  };
}

/**
 * Execute lookup_sku: fetch a product by SKU, enrich it (holds/honest-stock), and
 * pass through `features` + `fitments` for the SKU reply template. Mirrors
 * SearchExecution so the pipeline records the lookup the same way.
 */
export async function executeLookupSku(
  inventory: InventoryClient,
  sku: string,
  activeHoldQty: ActiveHoldLookup,
): Promise<SearchExecution> {
  const outcome = await inventory.lookupBySku(sku);

  if (outcome.status === 'api_error') {
    return {
      toolResult: JSON.stringify({
        error: 'inventory_unavailable',
        message:
          'The inventory system could not be reached. Do not state any numbers; tell the customer a staff member will follow up.',
      }),
      lookupResult: 'api_error',
      firstProductId: null,
      firstPrice: null,
      firstWarehouse: null,
      firstEffectiveQty: null,
      firstApiQty: null,
    };
  }

  const results = outcome.results;
  if (results.length === 0) {
    return {
      toolResult: JSON.stringify({ results: [], message: `No product found with SKU ${sku}.` }),
      lookupResult: 'not_found',
      firstProductId: null,
      firstPrice: null,
      firstWarehouse: null,
      firstEffectiveQty: null,
      firstApiQty: null,
    };
  }

  const item = results[0]!;
  const enriched = await enrichItem(item, activeHoldQty);
  const firstApiQty = item.inventory.reduce((sum, w) => sum + w.qty, 0);
  const inStockWarehouse = item.inventory.find((w) => w.qty > 0)?.warehouse ?? null;

  // Hand the model the enriched item PLUS the SKU extras (features, fitments).
  const toolResult = JSON.stringify({
    results: [{ ...enriched, features: item.features, fitments: item.fitments }],
  });

  return {
    toolResult,
    lookupResult: enriched.effective_qty > 0 ? 'found' : 'no_stock',
    firstProductId: enriched.product_id,
    firstPrice: enriched.price,
    firstWarehouse: inStockWarehouse,
    firstEffectiveQty: enriched.effective_qty,
    firstApiQty,
  };
}
