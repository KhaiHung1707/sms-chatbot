import type {
  Conversation,
  Customer,
  Message,
  MessageDirection,
} from '../types.js';

/**
 * Data-access contract. The pipeline depends on this interface, not on a
 * concrete database, so the required integration scenarios can run against an
 * in-memory implementation with no live Postgres.
 *
 * Two implementations:
 *   - PgStore (src/db/pgStore.ts)      — postgres.js, production
 *   - MemoryStore (tests/memoryStore)  — in-memory, tests
 */
export interface Store {
  getCustomerByPhone(phone: string): Promise<Customer | null>;
  createCustomer(phone: string): Promise<Customer>;
  setOptedOut(customerId: string, optedOut: boolean): Promise<void>;
  setLanguage(customerId: string, language: string): Promise<void>;

  /** Most recent open, non-expired conversation for a customer, if any. */
  getOpenConversation(customerId: string): Promise<Conversation | null>;
  createConversation(customerId: string, expiresAt: Date): Promise<Conversation>;
  extendConversation(conversationId: string, expiresAt: Date): Promise<void>;
  setConversationStatus(
    conversationId: string,
    status: Conversation['status'],
  ): Promise<void>;

  /**
   * Insert an inbound message. Returns null if the provider_message_id already
   * exists (dedupe, R-10) — the caller must then stop processing.
   */
  insertInboundMessage(
    conversationId: string,
    body: string,
    providerMessageId: string,
  ): Promise<Message | null>;

  insertOutboundMessage(conversationId: string, body: string): Promise<Message>;

  /**
   * Record the Quo message id returned when the bot sends an outbound SMS.
   * Used to tell the bot's own messages apart from staff-sent ones (C-01):
   * an outbound webhook whose provider id we recorded here is the bot's; one we
   * didn't is a staff reply → handoff.
   */
  setOutboundProviderId(messageId: string, providerId: string): Promise<void>;

  /** True if this provider_message_id belongs to a message the BOT sent. */
  isBotSentProviderId(providerId: string): Promise<boolean>;

  /** Full ordered message history for a conversation (for LLM context). */
  getMessages(conversationId: string): Promise<Message[]>;

  /** Count of outbound messages ever sent to this customer (for opt-out notice). */
  countOutboundToCustomer(customerId: string): Promise<number>;

  recordLookup(input: {
    conversationId: string;
    year: number | null;
    make: string | null;
    model: string | null;
    partType: string | null;
    wcProductId: number | null;
    priceSnapshot: number | null;
    warehouse: string | null;
    /** Effective qty quoted to the customer at reply time (audit, Update 001). */
    effectiveQty: number | null;
    result: string;
  }): Promise<{ id: string }>;

  /**
   * Update 001 Rule 2: total quantity currently on ACTIVE holds for a Woo
   * product, across all conversations. Used to compute effective availability
   * (`api_qty − active_holds`) before quoting stock. Returns 0 if none.
   */
  getActiveHoldQty(wcProductId: number): Promise<number>;

  /**
   * The most recent successful (`found`) lookup in a conversation — its id,
   * Woo product id, and the search params. Used to recover hold context when
   * the customer confirms a hold in a SEPARATE message from the search (the LLM
   * often splits them): create_hold re-runs the search from these params to get
   * a FRESH stock count, then reserves. Returns null if no found lookup yet.
   */
  getLatestFoundLookup(conversationId: string): Promise<{
    id: string;
    wcProductId: number;
    year: number;
    make: string;
    model: string;
    part: string;
  } | null>;

  /**
   * Update 001 Rule 2: atomically reserve a hold only if effective availability
   * allows it. Checks `apiQty − SUM(active holds for this product) >= qty` and
   * inserts the hold in a SINGLE transaction, so two simultaneous conversations
   * cannot both reserve the last unit.
   *
   * Returns the hold id on success, or null if there was not enough effective
   * availability (the caller then tells the customer it's no longer available).
   */
  createHoldIfAvailable(input: {
    lookupId: string;
    wcProductId: number;
    apiQty: number;
    qty: number;
    expiresAt: Date;
  }): Promise<{ id: string } | null>;

  /** Cron: mark active holds past their expiry as expired. Returns count. */
  expireHolds(now: Date): Promise<number>;

  /** Cron: close open conversations past their TTL. Returns count. */
  closeExpiredConversations(now: Date): Promise<number>;
}

export type { MessageDirection };
