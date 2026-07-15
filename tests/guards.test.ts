import { describe, it, expect } from 'vitest';
import { decideIntake, detectKeyword } from '../src/core/guards.js';
import type { InboundMessage } from '../src/types.js';

function msg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    providerMessageId: 'AC1',
    from: '+15105551234',
    to: '+15104512800',
    body: 'Hello',
    direction: 'incoming',
    hasMedia: false,
    userId: null,
    ...overrides,
  };
}

describe('decideIntake — fail-safe guards', () => {
  it('processes a normal inbound message', () => {
    expect(decideIntake(msg(), { isOptedOut: false, botUserId: null })).toEqual({
      action: 'process',
    });
  });

  it('ignores outgoing messages (R-06)', () => {
    const d = decideIntake(msg({ direction: 'outgoing' }), { isOptedOut: false, botUserId: null });
    expect(d.action).toBe('ignore');
  });

  it('ignores opted-out customers (R-15)', () => {
    const d = decideIntake(msg(), { isOptedOut: true, botUserId: null });
    expect(d.action).toBe('ignore');
  });

  it('asks for a text description on media-only messages (R-08)', () => {
    const d = decideIntake(msg({ hasMedia: true, body: '' }), { isOptedOut: false, botUserId: null });
    expect(d.action).toBe('reply_media_unsupported');
  });

  it('opt-out takes precedence over media', () => {
    const d = decideIntake(msg({ hasMedia: true, body: '' }), { isOptedOut: true, botUserId: null });
    expect(d.action).toBe('ignore');
  });
});

describe('detectKeyword', () => {
  it('detects STOP variants case-insensitively', () => {
    expect(detectKeyword('STOP')).toBe('stop');
    expect(detectKeyword('  unsubscribe ')).toBe('stop');
    expect(detectKeyword('Cancel')).toBe('stop');
  });
  it('detects HELP', () => {
    expect(detectKeyword('help')).toBe('help');
  });
  it('returns null for normal text', () => {
    expect(detectKeyword('95 Accord front bumper')).toBeNull();
  });
});
