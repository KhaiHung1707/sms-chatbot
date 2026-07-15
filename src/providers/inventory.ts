import { z } from 'zod';

/**
 * Client for the WordPress/WooCommerce Inventory API (a separate PHP plugin
 * deliverable). The middleware only calls the contract; see docs/inventory-api-spec.md.
 *
 * Handling per the guardrail (R-11): 8s timeout, retry once, and if it still
 * fails the caller must reply per the "never guess" rule — never invent numbers.
 */

const REQUEST_TIMEOUT_MS = 8_000;

const inventoryItemSchema = z.object({
  product_id: z.number(),
  sku: z.string(),
  title: z.string(),
  price: z.number(),
  variants: z.array(z.string()).optional().default([]),
  inventory: z.array(
    z.object({ warehouse: z.string(), qty: z.number() }),
  ),
});

const searchResponseSchema = z.object({
  results: z.array(inventoryItemSchema),
});

export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export interface InventorySearchParams {
  year: number;
  make: string;
  model: string;
  part: string;
}

export type InventorySearchOutcome =
  | { status: 'ok'; results: InventoryItem[] }
  | { status: 'api_error'; reason: string };

export interface InventoryConfig {
  baseUrl: string;
  apiKey: string;
}

export class InventoryClient {
  constructor(private readonly config: InventoryConfig) {}

  /**
   * Search the catalog. Returns a discriminated outcome rather than throwing,
   * so the pipeline can map `api_error` straight to the apologetic (no-number)
   * reply. Retries once on timeout/5xx before giving up.
   */
  async search(params: InventorySearchParams): Promise<InventorySearchOutcome> {
    const url = new URL(`${this.config.baseUrl}/parts/search`);
    url.searchParams.set('year', String(params.year));
    url.searchParams.set('make', params.make);
    url.searchParams.set('model', params.model);
    url.searchParams.set('part', params.part);

    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await this.attempt(url);
      if (outcome.status === 'ok') return outcome;
      // Only retry once; on the second failure return the api_error.
      if (attempt === 1) return outcome;
    }
    return { status: 'api_error', reason: 'exhausted retries' };
  }

  private async attempt(url: URL): Promise<InventorySearchOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'X-OBP-Api-Key': this.config.apiKey },
        signal: controller.signal,
      });

      if (res.status === 401) {
        return { status: 'api_error', reason: 'auth error (401)' };
      }
      if (res.status === 429) {
        return { status: 'api_error', reason: 'rate limited (429)' };
      }
      if (!res.ok) {
        return { status: 'api_error', reason: `http ${res.status}` };
      }

      const json = await res.json();
      const parsed = searchResponseSchema.safeParse(json);
      if (!parsed.success) {
        return { status: 'api_error', reason: 'malformed response' };
      }
      return { status: 'ok', results: parsed.data.results };
    } catch (err) {
      const reason =
        err instanceof Error && err.name === 'AbortError'
          ? 'timeout (8s)'
          : `network error: ${(err as Error).message}`;
      return { status: 'api_error', reason };
    } finally {
      clearTimeout(timer);
    }
  }
}
