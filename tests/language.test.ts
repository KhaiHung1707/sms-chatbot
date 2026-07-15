import { describe, it, expect } from 'vitest';
import { detectLanguageHint } from '../src/core/language.js';

describe('detectLanguageHint', () => {
  it('detects Vietnamese by diacritics', () => {
    expect(detectLanguageHint('cần cản trước cho xe Accord')).toBe('vi');
  });
  it('detects Spanish by distinctive words/chars', () => {
    expect(detectLanguageHint('necesito el parachoques delantero')).toBe('es');
    expect(detectLanguageHint('¿cuánto cuesta?')).toBe('es');
  });
  it('detects Chinese', () => {
    expect(detectLanguageHint('前保险杠多少钱')).toBe('zh');
  });
  it('detects English', () => {
    expect(detectLanguageHint('do you have a front bumper')).toBe('en');
  });
  it('returns null for ambiguous input (must not overwrite stored language)', () => {
    expect(detectLanguageHint('95')).toBeNull();
    expect(detectLanguageHint('48213')).toBeNull();
    expect(detectLanguageHint('')).toBeNull();
  });
});
