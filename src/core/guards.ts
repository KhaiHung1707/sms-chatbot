import type { InboundMessage } from '../types.js';

/**
 * Fail-safe intake guards (the highest-leverage risk mitigation).
 *
 * These run at the very front of the pipeline, BEFORE any expensive work
 * (LLM, DB writes), and default to silence. A single ordered gate neutralizes
 * several risks at once:
 *   - R-06: never reply to a message the bot or staff sent (direction/userId)
 *   - R-08: no MMS send capability → ask for a text description
 *   - R-15: opted-out customers are never answered (legal / TCPA)
 *
 * STOP / HELP keyword handling is a separate concern handled in the pipeline
 * (they DO warrant a reply / state change), but opt-out state is checked here.
 */

export type IntakeDecision =
  | { action: 'process' }
  | { action: 'ignore'; reason: string }
  | { action: 'reply_media_unsupported' };

export interface IntakeContext {
  /** Is this a message the bot itself is allowed to answer? */
  isOptedOut: boolean;
  /** Quo userId considered "the bot" (null/undefined if bot sends via number). */
  botUserId: string | null;
}

/**
 * Decide what to do with a raw inbound message. Pure function — no I/O — so it
 * is trivially unit-testable against the required scenarios.
 */
export function decideIntake(
  msg: InboundMessage,
  ctx: IntakeContext,
): IntakeDecision {
  // 1. Only inbound customer messages are ever answered. Outbound events
  //    (bot's own replies, staff replies in the Quo app) are for handoff
  //    detection elsewhere, never for replying.
  if (msg.direction !== 'incoming') {
    return { action: 'ignore', reason: 'not an incoming message' };
  }

  // 2. Opted-out customers: permanent silence.
  if (ctx.isOptedOut) {
    return { action: 'ignore', reason: 'customer opted out' };
  }

  // 3. Media (MMS): we cannot view or send images via the Quo API.
  if (msg.hasMedia && msg.body.trim() === '') {
    return { action: 'reply_media_unsupported' };
  }

  return { action: 'process' };
}

/**
 * STOP / HELP keyword detection (case-insensitive). English keywords are the
 * carrier-standard opt-out words; a few common Spanish/Vietnamese equivalents
 * are included since the shop serves those customers.
 */
const STOP_KEYWORDS = new Set([
  'stop',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
  'stopall',
  // Spanish
  'alto',
  'parar',
  // Vietnamese
  'dung',
  'hủy',
  'huy',
]);
const HELP_KEYWORDS = new Set(['help', 'info', 'ayuda', 'trợ giúp', 'tro giup']);

export type KeywordCommand = 'stop' | 'help' | null;

export function detectKeyword(body: string): KeywordCommand {
  const normalized = body.trim().toLowerCase();
  if (STOP_KEYWORDS.has(normalized)) return 'stop';
  if (HELP_KEYWORDS.has(normalized)) return 'help';
  return null;
}
