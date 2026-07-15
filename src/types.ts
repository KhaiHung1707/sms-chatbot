/**
 * Shared domain types. DB rows mirror migrations/001_init.sql.
 */

export type ConversationStatus = 'open' | 'closed' | 'handed_off';
export type MessageDirection = 'in' | 'out';
export type LookupResult = 'found' | 'no_stock' | 'not_found' | 'api_error';
export type HoldStatus = 'active' | 'expired' | 'fulfilled' | 'cancelled';

export interface Customer {
  id: string;
  phone: string;
  language: string;
  opted_out: boolean;
  created_at: string;
}

export interface Conversation {
  id: string;
  customer_id: string;
  status: ConversationStatus;
  channel: string;
  expires_at: string;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  body: string;
  provider_message_id: string | null;
  created_at: string;
}

/**
 * A single inbound SMS, normalized from the Quo webhook payload. This is the
 * shape the rest of the app works with — providers/quo.ts owns the mapping.
 */
export interface InboundMessage {
  providerMessageId: string;
  from: string; // E.164, the customer
  to: string; // E.164, the shop's Quo number
  body: string;
  direction: 'incoming' | 'outgoing';
  hasMedia: boolean;
  /** userId from Quo, used to tell bot/staff-sent messages apart. */
  userId: string | null;
}
