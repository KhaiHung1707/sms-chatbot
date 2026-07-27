/**
 * Validation + normalization for the editable instruction steps a shop owner
 * saves from the admin page. Caps size, strips control chars, and rejects steps
 * that would smuggle LOCKED/technical behavior into the editable slot (a tool
 * name, a URL, the [[SILENT]] token). Fuzzy safety warnings live in promptLint.
 */

export const MAX_STEPS = 25;
export const MAX_STEP_LEN = 600;

const FORBIDDEN_SUBSTR = [
  'search_inventory',
  'lookup_sku',
  'create_hold',
  '[[silent]]',
  'http://',
  'https://',
];

export interface StepsValidation {
  ok: boolean;
  steps: string[]; // normalized (trimmed, control chars stripped)
  errors: string[]; // hard errors (block save)
}

/** Strip ASCII control chars except tab/newline/carriage-return. */
function stripControlChars(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    const isControl = (code >= 0 && code <= 31 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    if (!isControl) out += ch;
  }
  return out;
}

/** Normalize + hard-validate. Hard errors block SAVE (not just publish). */
export function validateSteps(input: unknown): StepsValidation {
  const errors: string[] = [];

  if (!Array.isArray(input)) {
    return { ok: false, steps: [], errors: ['Steps must be a list.'] };
  }
  const steps = input
    .map((s) => (typeof s === 'string' ? s : ''))
    .map((s) => stripControlChars(s).trim())
    .filter((s) => s.length > 0);

  if (steps.length === 0) errors.push('You need at least one step.');
  if (steps.length > MAX_STEPS) errors.push(`Too many steps (max ${MAX_STEPS}).`);

  steps.forEach((s, i) => {
    if (s.length > MAX_STEP_LEN) {
      errors.push(`Step ${i + 1} is too long (max ${MAX_STEP_LEN} characters).`);
    }
    const lower = s.toLowerCase();
    for (const bad of FORBIDDEN_SUBSTR) {
      if (lower.includes(bad)) {
        errors.push(
          `Step ${i + 1} can't contain "${bad}" — that's part of the bot's built-in setup, not something to write here.`,
        );
      }
    }
  });

  return { ok: errors.length === 0, steps, errors };
}
