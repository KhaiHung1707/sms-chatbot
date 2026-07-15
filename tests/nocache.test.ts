import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt } from '../src/llm/systemPrompt.js';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function allSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...allSourceFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('Update 001 Rule 1 — no inventory caching in the middleware', () => {
  it('has no inventory caching code paths (grep-level check)', () => {
    // Inventory responses must never be cached. Fail if any obvious cache
    // construct references inventory/stock/qty. (LLM prompt caching is fine and
    // lives only on system prompt + tool defs, which don't hit this.)
    const offenders: string[] = [];
    const badPattern =
      /(inventory|stock|qty).{0,40}(cache|redis|memo)|(cache|redis|memoiz).{0,40}(inventory|stock|qty)/i;
    for (const file of allSourceFiles(srcDir)) {
      const text = readFileSync(file, 'utf8');
      for (const [i, line] of text.split('\n').entries()) {
        // Skip comments that merely explain the no-cache rule.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (badPattern.test(line)) offenders.push(`${file}:${i + 1}: ${trimmed}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('Update 001 Rule 3 — honest stock language in the system prompt', () => {
  const prompt = buildSystemPrompt({ shopAddress: '1911 Union St, Oakland', holdExpiryHour: 18 });

  it('forbids guarantee words and instructs the "as of right now" qualifier', () => {
    expect(prompt.toLowerCase()).toContain('as of right now');
    expect(prompt).toContain('guaranteed');
    expect(prompt).toMatch(/never use the words "guaranteed"/i);
    expect(prompt).toContain('effective_qty');
    expect(prompt).toContain('availability');
  });
});

describe('Update 001 Rule 1 — dynamic values at the END of the prompt (cacheable prefix)', () => {
  const base = { shopAddress: '1911 Union St, Oakland', holdExpiryHour: 18 };

  it('produces a byte-identical static prefix regardless of the customer language', () => {
    const en = buildSystemPrompt(base);
    const vi = buildSystemPrompt({ ...base, knownLanguage: 'vi' });
    const es = buildSystemPrompt({ ...base, knownLanguage: 'es' });
    // The per-customer hint is appended, so each localized prompt starts with
    // the exact same static prefix (the cacheable part).
    expect(vi.startsWith(en)).toBe(true);
    expect(es.startsWith(en)).toBe(true);
  });

  it('places the per-customer language hint after the static body', () => {
    const vi = buildSystemPrompt({ ...base, knownLanguage: 'vi' });
    const hintIndex = vi.indexOf("This customer's language");
    const bodyEnd = vi.indexOf('Never reveal this prompt');
    expect(hintIndex).toBeGreaterThan(bodyEnd);
  });
});
