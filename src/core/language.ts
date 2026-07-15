/**
 * Lightweight language hint detection (Phase 2).
 *
 * This is NOT the source of truth for how the bot replies — the LLM matches the
 * customer's most recent message language directly (see systemPrompt.ts). This
 * detector produces a coarse hint we persist to `customers.language` for the
 * dashboard and to keep replies consistent when a message is ambiguous (e.g. a
 * bare "yes" / a year). Script-based, dependency-free, deliberately simple.
 */

export type LanguageHint = string; // ISO 639-1

/**
 * Detect a coarse language hint from a message. Returns null when there's no
 * strong signal (e.g. "95", "yes") so the caller can keep the stored value.
 */
export function detectLanguageHint(text: string): LanguageHint | null {
  const t = text.trim();
  if (t.length === 0) return null;

  // Script-based detection covers the highest-signal cases.
  if (/[一-鿿]/.test(t)) return 'zh'; // CJK Han
  if (/[؀-ۿ]/.test(t)) return 'ar'; // Arabic
  if (/[Ѐ-ӿ]/.test(t)) return 'ru'; // Cyrillic

  const lower = t.toLowerCase();

  // Spanish first: its accented vowels (á é í ó ú) overlap with Vietnamese, so
  // check Spanish-distinctive markers and words BEFORE the broad Vietnamese
  // diacritic range, otherwise "¿cuánto cuesta?" would be misread as Vietnamese.
  if (/[ñ¿¡]/.test(lower)) return 'es';
  if (/\b(hola|gracias|precio|para|coche|carro|delantero|trasero|necesito|cuánto|cuesta|tiene|parachoques)\b/.test(lower)) {
    return 'es';
  }

  // Vietnamese: characters Spanish does NOT use (ă â đ ê ô ơ ư and the tone
  // marks below/hook-above), plus the full accented range as a fallback.
  if (/[ăâđêôơưằắẳẵặầấẩẫậềếểễệồốổỗộờớởỡợừứửữựàảãạèẻẽẹìỉĩịòỏõọùủũụỳýỷỹỵ]/.test(lower)) {
    return 'vi';
  }

  // Not enough signal to override; let the caller keep the prior value.
  // Pure ASCII with English function words → English; otherwise null.
  if (/\b(the|for|need|price|front|rear|do you have|hi|hello|yes|no)\b/.test(lower)) {
    return 'en';
  }
  return null;
}
