import { buildSystemPrompt } from '../llm/systemPrompt.js';
import { stripForeignLinks } from '../core/pipeline.js';
import {
  executeSearchInventory,
  executeLookupSku,
  searchInventorySchema,
  lookupSkuSchema,
} from '../llm/tools.js';
import type { LlmClient } from '../llm/claude.js';
import type { InventoryClient } from '../providers/inventory.js';
import type { Config } from '../config.js';

/**
 * Run a test customer message against DRAFT steps, with NO effect on live state:
 * - builds the prompt from the draft steps (LOCKED header/footer still appended)
 * - runs the LLM loop directly (NOT the Pipeline) so it cannot touch conversation
 *   state, and never constructs a QuoClient → no SMS is ever sent
 * - tools are READ-ONLY: search_inventory / lookup_sku hit the real inventory
 *   (realistic), but create_hold is STUBBED to held:false so a preview can never
 *   reserve real stock
 * - the reply is passed through stripForeignLinks, exactly like a real reply
 *
 * Returns the reply text the customer WOULD see (or a "stayed silent" marker).
 */
export interface PreviewResult {
  reply: string;
  silent: boolean;
}

/** A single prior turn in the preview conversation. */
export interface PreviewTurn {
  who: 'customer' | 'bot';
  text: string;
}

export async function runPreview(opts: {
  llm: LlmClient;
  inventory: InventoryClient;
  config: Config;
  steps: string[];
  message: string;
  /** Prior turns of THIS preview conversation, oldest first (optional). */
  history?: PreviewTurn[];
}): Promise<PreviewResult> {
  const { llm, inventory, config, steps, message, history = [] } = opts;

  const system = buildSystemPrompt({
    shopAddress: config.SHOP_ADDRESS,
    holdExpiryHour: config.HOLD_EXPIRY_HOUR,
    knownLanguage: null,
    steps,
  });

  // Read-only tool executor: real reads, no writes, holds always stubbed.
  const executeTool = async (name: string, input: unknown): Promise<string> => {
    if (name === 'search_inventory') {
      const parsed = searchInventorySchema.safeParse(input);
      if (!parsed.success) return JSON.stringify({ error: 'invalid_input' });
      // activeHoldQty is a no-op in preview (0) — we don't touch the holds table.
      const exec = await executeSearchInventory(inventory, parsed.data, async () => 0);
      return exec.toolResult;
    }
    if (name === 'lookup_sku') {
      const parsed = lookupSkuSchema.safeParse(input);
      if (!parsed.success) return JSON.stringify({ error: 'invalid_input' });
      const exec = await executeLookupSku(inventory, parsed.data.sku, async () => 0);
      return exec.toolResult;
    }
    if (name === 'create_hold') {
      // Never reserve real stock from a preview.
      return JSON.stringify({
        held: false,
        reason: 'preview_mode',
        message: 'This is a preview — no hold was actually placed. Tell the customer it is held (in a real conversation it would be).',
      });
    }
    return JSON.stringify({ error: 'unknown_tool' });
  };

  // Build the conversation: prior turns (customer→user, bot→assistant) + the new
  // customer message. Mirrors how the real pipeline maps stored messages.
  const messages = [
    ...history.map((t) => ({
      role: (t.who === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: t.text,
    })),
    { role: 'user' as const, content: message },
  ];

  let reply = '';
  try {
    const result = await llm.runTurn(system, messages, executeTool);
    reply = result.reply.trim();
  } catch {
    return { reply: '', silent: true };
  }

  const safe = stripForeignLinks(reply);
  const silent = safe === '' || safe.toUpperCase().includes('[[SILENT]]');
  return { reply: silent ? '' : safe, silent };
}
