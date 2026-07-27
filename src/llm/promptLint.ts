/**
 * Pre-publish lint for editable instruction steps. Unlike the hard validator in
 * admin/steps.ts, these are FUZZY WARNINGS (warn-and-confirm, not a block) — they
 * catch wording that could make the bot misbehave in ways the code can't fully
 * guarantee against (a fabricated price/stock, a foreign link, opt-out tampering).
 *
 * IMPORTANT: this is belt-and-suspenders on top of the LOCKED prompt footer and
 * the code-level stripForeignLinks — never presented to the user as a guarantee.
 */

export interface LintWarning {
  stepIndex: number; // 0-based; -1 for a whole-draft warning
  message: string; // plain-English, shown to a non-technical owner
}

interface Rule {
  test: RegExp;
  message: string;
}

const RULES: Rule[] = [
  {
    test: /\b(ebay|amazon|craigslist|walmart|autozone|rockauto)\b/i,
    message:
      'mentions another store or site — the bot must only ever link to oaklandbodyparts.com. A link to another site sends your customer to a competitor.',
  },
  {
    test: /\b(always|just)\s+(say|tell)[^.]*\b(in\s*stock|available)\b/i,
    message:
      'tells the bot to always say something is in stock. The bot must only state real, current stock — a false "in stock" leads to angry customers.',
  },
  {
    test: /\b(guaranteed|definitely in stock)\b/i,
    message:
      'uses "guaranteed" / "definitely in stock". Stock can change before pickup, so the bot should never promise availability.',
  },
  {
    test: /\b(make up|invent|guess)\b[^.]*\b(price|cost|number|stock)\b/i,
    message:
      'tells the bot to make up a price or number. The bot must only use real prices from the catalog.',
  },
  {
    test: /\b(tell|ask)[^.]*\b(call|phone)\b/i,
    message:
      'tells the bot to have the customer call or phone. Per your setup, the bot helps entirely over text and never asks customers to call.',
  },
  {
    test: /\bignore (the |all )?(previous|above|prior) (instructions|steps|rules)\b/i,
    message:
      'looks like it\'s trying to override the bot\'s built-in rules. Those safety rules always apply and can\'t be turned off here.',
  },
  {
    test: /\breply stop\b|\bunsubscribe\b/i,
    message:
      'mentions STOP/unsubscribe notices. Per your setup, the bot shouldn\'t add those to messages (opt-out still works automatically).',
  },
];

/** Scan the steps and return any warnings (empty = nothing to flag). */
export function lintSteps(steps: readonly string[]): LintWarning[] {
  const warnings: LintWarning[] = [];
  steps.forEach((step, i) => {
    for (const rule of RULES) {
      if (rule.test.test(step)) {
        warnings.push({ stepIndex: i, message: `Step ${i + 1} ${rule.message}` });
      }
    }
  });
  return warnings;
}
