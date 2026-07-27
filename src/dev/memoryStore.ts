import { randomUUID } from 'node:crypto';
import type { Store, InstructionVersion } from '../db/store.js';
import type { Conversation, Customer, Message } from '../types.js';

/**
 * In-memory Store — used by the local dev harness (src/dev/server.ts) and by
 * the integration tests. Mirrors PgStore semantics, including dedupe-on-insert
 * for provider_message_id and the effective-availability hold logic.
 */
export class MemoryStore implements Store {
  customers = new Map<string, Customer>();
  conversations = new Map<string, Conversation>();
  messages: Message[] = [];
  lookups = new Map<
    string,
    {
      conversationId: string; wcProductId: number | null; result: string;
      year: number | null; make: string | null; model: string | null; partType: string | null;
      sku: string | null;
    }
  >();
  lookupOrder: string[] = []; // insertion order, for getLatestFoundLookup
  holds: { id: string; lookupId: string; qty: number; expiresAt: Date; status: string }[] = [];
  private seenProviderIds = new Set<string>();

  async getCustomerByPhone(phone: string): Promise<Customer | null> {
    for (const c of this.customers.values()) if (c.phone === phone) return c;
    return null;
  }

  async createCustomer(phone: string): Promise<Customer> {
    const c: Customer = {
      id: randomUUID(),
      phone,
      language: 'en',
      opted_out: false,
      created_at: new Date().toISOString(),
    };
    this.customers.set(c.id, c);
    return c;
  }

  async setOptedOut(customerId: string, optedOut: boolean): Promise<void> {
    const c = this.customers.get(customerId);
    if (c) c.opted_out = optedOut;
  }

  async setLanguage(customerId: string, language: string): Promise<void> {
    const c = this.customers.get(customerId);
    if (c) c.language = language;
  }

  async getOpenConversation(customerId: string): Promise<Conversation | null> {
    const now = Date.now();
    const open = [...this.conversations.values()]
      .filter(
        (c) => c.customer_id === customerId && c.status !== 'closed' && new Date(c.expires_at).getTime() > now,
      )
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return open[0] ?? null;
  }

  async createConversation(customerId: string, expiresAt: Date): Promise<Conversation> {
    const conv: Conversation = {
      id: randomUUID(),
      customer_id: customerId,
      status: 'open',
      channel: 'sms',
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString(),
    };
    this.conversations.set(conv.id, conv);
    return conv;
  }

  async extendConversation(conversationId: string, expiresAt: Date): Promise<void> {
    const c = this.conversations.get(conversationId);
    if (c) c.expires_at = expiresAt.toISOString();
  }

  async setConversationStatus(conversationId: string, status: Conversation['status']): Promise<void> {
    const c = this.conversations.get(conversationId);
    if (c) c.status = status;
  }

  async insertInboundMessage(
    conversationId: string,
    body: string,
    providerMessageId: string,
  ): Promise<Message | null> {
    if (this.seenProviderIds.has(providerMessageId)) return null; // dedupe
    this.seenProviderIds.add(providerMessageId);
    const m: Message = {
      id: randomUUID(),
      conversation_id: conversationId,
      direction: 'in',
      body,
      provider_message_id: providerMessageId,
      created_at: new Date().toISOString(),
    };
    this.messages.push(m);
    return m;
  }

  async insertOutboundMessage(conversationId: string, body: string): Promise<Message> {
    const m: Message = {
      id: randomUUID(),
      conversation_id: conversationId,
      direction: 'out',
      body,
      provider_message_id: null,
      created_at: new Date().toISOString(),
    };
    this.messages.push(m);
    return m;
  }

  async deleteMessage(messageId: string): Promise<void> {
    const i = this.messages.findIndex((m) => m.id === messageId);
    if (i !== -1) this.messages.splice(i, 1);
  }

  async setOutboundProviderId(messageId: string, providerId: string): Promise<void> {
    const m = this.messages.find((x) => x.id === messageId && x.direction === 'out');
    if (m) m.provider_message_id = providerId;
  }

  async isBotSentProviderId(providerId: string): Promise<boolean> {
    return this.messages.some(
      (m) => m.direction === 'out' && m.provider_message_id === providerId,
    );
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return this.messages
      .filter((m) => m.conversation_id === conversationId)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  }

  async countOutboundToCustomer(customerId: string): Promise<number> {
    const convIds = new Set(
      [...this.conversations.values()].filter((c) => c.customer_id === customerId).map((c) => c.id),
    );
    return this.messages.filter((m) => m.direction === 'out' && convIds.has(m.conversation_id)).length;
  }

  async recordLookup(input: Parameters<Store['recordLookup']>[0]): Promise<{ id: string }> {
    const id = randomUUID();
    this.lookups.set(id, {
      conversationId: input.conversationId,
      wcProductId: input.wcProductId,
      result: input.result,
      year: input.year,
      make: input.make,
      model: input.model,
      partType: input.partType,
      sku: input.sku ?? null,
    });
    this.lookupOrder.push(id);
    return { id };
  }

  private activeHeldFor(wcProductId: number, now = new Date()): number {
    let total = 0;
    for (const h of this.holds) {
      // Mirror PgStore: a hold counts only if active AND not past expiry, so a
      // hold that lapsed before the expiry cron ran doesn't over-report.
      if (h.status !== 'active' || h.expiresAt <= now) continue;
      const lookup = this.lookups.get(h.lookupId);
      if (lookup?.wcProductId === wcProductId) total += h.qty;
    }
    return total;
  }

  async getActiveHoldQty(wcProductId: number): Promise<number> {
    return this.activeHeldFor(wcProductId);
  }

  async getLatestFoundLookup(conversationId: string): Promise<{
    id: string; wcProductId: number;
    year: number | null; make: string | null; model: string | null; part: string | null;
    sku: string | null;
  } | null> {
    // Most recent 'found' lookup with a product id, for this conversation. It's
    // recoverable if it has either full ymm (vehicle search) OR a sku (SKU lookup).
    for (let i = this.lookupOrder.length - 1; i >= 0; i--) {
      const id = this.lookupOrder[i]!;
      const l = this.lookups.get(id);
      const hasYmm = l && l.year !== null && l.make !== null && l.model !== null && l.partType !== null;
      const hasSku = l && l.sku !== null;
      if (
        l && l.conversationId === conversationId && l.result === 'found' &&
        l.wcProductId !== null && (hasYmm || hasSku)
      ) {
        return {
          id, wcProductId: l.wcProductId,
          year: l.year, make: l.make, model: l.model, part: l.partType, sku: l.sku,
        };
      }
    }
    return null;
  }

  async createHoldIfAvailable(
    input: Parameters<Store['createHoldIfAvailable']>[0],
  ): Promise<{ id: string } | null> {
    // In-memory analog of the transactional check. Single-threaded JS makes
    // this atomic within one await-free critical section.
    const effective = input.apiQty - this.activeHeldFor(input.wcProductId);
    if (effective < input.qty) return null;
    const id = randomUUID();
    this.holds.push({ id, lookupId: input.lookupId, qty: input.qty, expiresAt: input.expiresAt, status: 'active' });
    return { id };
  }

  async expireHolds(now: Date): Promise<number> {
    let count = 0;
    for (const h of this.holds) {
      if (h.status === 'active' && h.expiresAt <= now) {
        h.status = 'expired';
        count++;
      }
    }
    return count;
  }

  async closeExpiredConversations(now: Date): Promise<number> {
    let count = 0;
    for (const c of this.conversations.values()) {
      if (c.status === 'open' && new Date(c.expires_at) <= now) {
        c.status = 'closed';
        count++;
      }
    }
    return count;
  }

  /** Helper: outbound message bodies sent to a customer, in order. */
  outboundBodies(): string[] {
    return this.messages.filter((m) => m.direction === 'out').map((m) => m.body);
  }

  // ── Editable bot instructions ───────────────────────────────────────────────
  instructionVersions: InstructionVersion[] = [];

  private nextInstrVersion(): number {
    return this.instructionVersions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
  }

  async getLiveInstructions(): Promise<InstructionVersion | null> {
    return this.instructionVersions.find((v) => v.status === 'live') ?? null;
  }

  async getDraftInstructions(): Promise<InstructionVersion | null> {
    return this.instructionVersions.find((v) => v.status === 'draft') ?? null;
  }

  async saveDraftInstructions(steps: string[], author: string | null): Promise<InstructionVersion> {
    this.instructionVersions = this.instructionVersions.filter((v) => v.status !== 'draft');
    const draft: InstructionVersion = {
      id: randomUUID(), version: this.nextInstrVersion(), steps: [...steps],
      status: 'draft', note: null, author, createdAt: new Date().toISOString(), publishedAt: null,
    };
    this.instructionVersions.push(draft);
    return draft;
  }

  async publishDraftInstructions(note: string | null): Promise<InstructionVersion | null> {
    const draft = this.instructionVersions.find((v) => v.status === 'draft');
    if (!draft) return null;
    for (const v of this.instructionVersions) if (v.status === 'live') v.status = 'archived';
    draft.status = 'live';
    draft.note = note;
    draft.publishedAt = new Date().toISOString();
    return draft;
  }

  async listInstructionVersions(): Promise<InstructionVersion[]> {
    return [...this.instructionVersions].sort((a, b) => b.version - a.version);
  }

  async restoreInstructionVersion(id: string, author: string | null): Promise<InstructionVersion | null> {
    const src = this.instructionVersions.find((v) => v.id === id);
    if (!src) return null;
    this.instructionVersions = this.instructionVersions.filter((v) => v.status !== 'draft');
    const draft: InstructionVersion = {
      id: randomUUID(), version: this.nextInstrVersion(), steps: [...src.steps],
      status: 'draft', note: 'Restored from an earlier version', author,
      createdAt: new Date().toISOString(), publishedAt: null,
    };
    this.instructionVersions.push(draft);
    return draft;
  }
}
