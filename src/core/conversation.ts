import type { Store } from '../db/store.js';
import type { Conversation, Customer } from '../types.js';

/**
 * Conversation + customer lifecycle: load or create by phone, keyed to a TTL
 * that is extended on every new message. Handoff logic lives here too.
 */
export class ConversationManager {
  constructor(
    private readonly store: Store,
    private readonly ttlHours: number,
  ) {}

  /** Find an existing customer by phone or create one. */
  async getOrCreateCustomer(phone: string): Promise<Customer> {
    const existing = await this.store.getCustomerByPhone(phone);
    return existing ?? (await this.store.createCustomer(phone));
  }

  /**
   * Return the customer's open, non-expired conversation, creating a fresh one
   * if none exists. Extends the TTL on the returned conversation.
   */
  async getOrCreateConversation(customerId: string): Promise<Conversation> {
    const expiresAt = this.nextExpiry();
    const open = await this.store.getOpenConversation(customerId);
    if (open) {
      await this.store.extendConversation(open.id, expiresAt);
      return { ...open, expires_at: expiresAt.toISOString() };
    }
    return this.store.createConversation(customerId, expiresAt);
  }

  private nextExpiry(now = new Date()): Date {
    return new Date(now.getTime() + this.ttlHours * 60 * 60 * 1000);
  }

  /**
   * Handoff detection (R-06): if a staff member has replied manually in the
   * Quo app, that surfaces as an OUTBOUND message not sent by the bot. When we
   * observe such an event, mark the conversation handed_off; the bot then stops
   * replying until the TTL expires.
   *
   * The webhook route only forwards inbound messages to the pipeline, but an
   * outbound event routed here flips the flag.
   */
  async markHandedOff(conversationId: string): Promise<void> {
    await this.store.setConversationStatus(conversationId, 'handed_off');
  }

  async isHandedOff(customerId: string): Promise<boolean> {
    const open = await this.store.getOpenConversation(customerId);
    return open?.status === 'handed_off';
  }
}
