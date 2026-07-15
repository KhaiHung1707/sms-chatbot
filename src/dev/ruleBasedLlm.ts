import type Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmTurnResult, ToolExecutor } from '../llm/claude.js';

/**
 * A rule-based fake LLM for local dev. It is NOT an AI — it's a small state
 * machine that mimics the bot's shape so you can watch the full pipeline run
 * without an Anthropic key:
 *
 *   - Accumulates year/make/model/part from the whole conversation.
 *   - Missing pieces → asks a follow-up (reproduces the confidence gate).
 *   - Complete + confirmed → calls search_inventory, then quotes the effective
 *     qty with band-appropriate phrasing (Update 001 Rule 3).
 *   - "yes"/"hold" after a result → calls create_hold.
 *
 * Limitations: it does simple keyword parsing, so it does NOT exercise real
 * multilingual / typo extraction. Swap this for AnthropicClient (one line in
 * server.ts) with a real key to test that.
 */

const MAKES = ['honda', 'toyota', 'ford', 'chevy', 'chevrolet', 'nissan', 'mazda'];
const MODELS = ['accord', 'civic', 'camry', 'corolla', 'f-150', 'mustang', 'altima'];
/** A model implies its make (a safe inference a real LLM also makes). */
const MODEL_MAKE: Record<string, string> = {
  accord: 'honda', civic: 'honda',
  camry: 'toyota', corolla: 'toyota',
  'f-150': 'ford', mustang: 'ford',
  altima: 'nissan',
};
const PARTS = [
  'front bumper', 'rear bumper', 'bumper', 'left mirror', 'right mirror', 'mirror',
  'tail light', 'head light', 'hood', 'fender',
];

interface Parsed {
  year?: number;
  make?: string;
  model?: string;
  part?: string;
  wantsHold: boolean;
  confirmedYes: boolean;
}

export class RuleBasedLlm implements LlmClient {
  async runTurn(
    _system: string,
    history: Anthropic.MessageParam[],
    executeTool: ToolExecutor,
  ): Promise<LlmTurnResult> {
    const userText = history
      .filter((m) => m.role === 'user')
      .map((m) => extractText(m.content))
      .join(' ')
      .toLowerCase();

    const p = parse(userText);

    // Missing pieces → ask (confidence gate). Ask for the most specific gap.
    const missing: string[] = [];
    if (p.year === undefined) missing.push('the year');
    if (!p.make) missing.push('the make');
    if (!p.model) missing.push('the model');
    if (!p.part) missing.push('the part (e.g. front or rear bumper)');
    if (missing.length > 0) {
      return reply(`Happy to help! Could you tell me ${missing.slice(0, 2).join(' and ')}?`);
    }

    // Complete but not yet confirmed → confirm before quoting.
    if (!p.confirmedYes && !p.wantsHold) {
      return reply(
        `Got it — ${p.part} for a ${p.year} ${cap(p.make!)} ${cap(p.model!)}? Reply "yes" to check price.`,
      );
    }

    // Confirmed → search.
    const searchResult = await executeTool('search_inventory', {
      year: p.year, make: p.make, model: p.model, part: p.part,
    });
    const parsed = JSON.parse(searchResult) as {
      error?: string;
      results?: Array<{ product_id: number; title: string; price: number; effective_qty: number; availability: string }>;
    };

    if (parsed.error) {
      return reply("I can't look that up right now — a staff member will follow up shortly.", 1);
    }
    const results = parsed.results ?? [];
    if (results.length === 0) {
      return reply(`I couldn't find that part for a ${p.year} ${cap(p.make!)} ${cap(p.model!)}. Try calling the shop?`, 1);
    }

    const first = results[0]!;

    // Wants a hold and we have a result → create it.
    if (p.wantsHold) {
      const holdResult = await executeTool('create_hold', { product_id: first.product_id, qty: 1 });
      const hp = JSON.parse(holdResult) as { held: boolean };
      if (!hp.held) {
        return reply(`That one was just sold or reserved — sorry! Want me to check anything else?`, 2);
      }
      return reply(`Done ✔ Held until 6 PM today at 1911 Union St, Oakland. See you soon!`, 2);
    }

    // Quote with band-appropriate phrasing.
    if (first.availability === 'out') {
      return reply(`The ${first.title} is out of stock right now. Want me to check an alternative?`, 1);
    }
    if (first.availability === 'low') {
      return reply(
        `${first.title}: $${first.price}, only ${first.effective_qty} left as of right now — stock changes through the day, so I'd recommend a hold. Want me to hold it?`,
        1,
      );
    }
    return reply(
      `${first.title}: $${first.price}, ${first.effective_qty} available for pickup at 1911 Union St, Oakland. Want me to hold one?`,
      1,
    );
  }
}

function parse(text: string): Parsed {
  const yearMatch = text.match(/\b(19|20)\d{2}\b/) ?? text.match(/\b(\d{2})\b/);
  let year: number | undefined;
  if (yearMatch) {
    const n = Number(yearMatch[0]);
    year = n < 100 ? (n > 30 ? 1900 + n : 2000 + n) : n;
  }
  let make = MAKES.find((m) => text.includes(m));
  const model = MODELS.find((m) => text.includes(m));
  // Infer the make from the model when the customer only named the model.
  if (!make && model && MODEL_MAKE[model]) make = MODEL_MAKE[model];
  // Longest part phrase wins ("front bumper" before "bumper").
  const part = [...PARTS].sort((a, b) => b.length - a.length).find((pt) => text.includes(pt));

  return {
    year,
    make: make === 'chevy' ? 'chevrolet' : make,
    model,
    part,
    wantsHold: /\b(hold|reserve|hold it|yes hold)\b/.test(text),
    confirmedYes: /\byes\b/.test(text),
  };
}

function extractText(content: Anthropic.MessageParam['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join(' ');
}

function reply(text: string, toolRounds = 0): LlmTurnResult {
  return { reply: text, toolRounds, usage: { inputTokens: 20, outputTokens: 15 } };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
