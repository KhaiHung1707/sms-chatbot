import postgres from 'postgres';
import type { Store } from './store.js';
import type { Conversation, Customer, Message } from '../types.js';

/**
 * postgres.js implementation of the Store contract. All queries are
 * parameterized via the tagged-template API (no string interpolation).
 */
export class PgStore implements Store {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 10 });
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async getCustomerByPhone(phone: string): Promise<Customer | null> {
    const rows = await this.sql<Customer[]>`
      select * from customers where phone = ${phone} limit 1`;
    return rows[0] ?? null;
  }

  async createCustomer(phone: string): Promise<Customer> {
    const rows = await this.sql<Customer[]>`
      insert into customers (phone) values (${phone}) returning *`;
    return rows[0]!;
  }

  async setOptedOut(customerId: string, optedOut: boolean): Promise<void> {
    await this.sql`
      update customers set opted_out = ${optedOut} where id = ${customerId}`;
  }

  async setLanguage(customerId: string, language: string): Promise<void> {
    await this.sql`
      update customers set language = ${language} where id = ${customerId}`;
  }

  async getOpenConversation(customerId: string): Promise<Conversation | null> {
    // "Active" = not closed. This MUST include handed_off conversations, or a
    // customer's next message would spawn a fresh 'open' conversation and the
    // bot would resume replying over the staff member (auto-handoff bug).
    const rows = await this.sql<Conversation[]>`
      select * from conversations
      where customer_id = ${customerId}
        and status <> 'closed'
        and expires_at > now()
      order by created_at desc
      limit 1`;
    return rows[0] ?? null;
  }

  async createConversation(customerId: string, expiresAt: Date): Promise<Conversation> {
    const rows = await this.sql<Conversation[]>`
      insert into conversations (customer_id, expires_at)
      values (${customerId}, ${expiresAt})
      returning *`;
    return rows[0]!;
  }

  async extendConversation(conversationId: string, expiresAt: Date): Promise<void> {
    await this.sql`
      update conversations set expires_at = ${expiresAt} where id = ${conversationId}`;
  }

  async setConversationStatus(
    conversationId: string,
    status: Conversation['status'],
  ): Promise<void> {
    await this.sql`
      update conversations set status = ${status} where id = ${conversationId}`;
  }

  async insertInboundMessage(
    conversationId: string,
    body: string,
    providerMessageId: string,
  ): Promise<Message | null> {
    // Dedupe via the PARTIAL unique index (idx_messages_provider_id, which is
    // defined WHERE provider_message_id IS NOT NULL). Postgres requires the
    // ON CONFLICT clause to repeat that predicate to match a partial index —
    // omitting it raises 42P10 "no unique constraint matching the ON CONFLICT".
    const rows = await this.sql<Message[]>`
      insert into messages (conversation_id, direction, body, provider_message_id)
      values (${conversationId}, 'in', ${body}, ${providerMessageId})
      on conflict (provider_message_id) where provider_message_id is not null do nothing
      returning *`;
    return rows[0] ?? null;
  }

  async insertOutboundMessage(conversationId: string, body: string): Promise<Message> {
    const rows = await this.sql<Message[]>`
      insert into messages (conversation_id, direction, body)
      values (${conversationId}, 'out', ${body})
      returning *`;
    return rows[0]!;
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.sql`delete from messages where id = ${messageId}`;
  }

  async setOutboundProviderId(messageId: string, providerId: string): Promise<void> {
    await this.sql`
      update messages set provider_message_id = ${providerId}
      where id = ${messageId} and direction = 'out'`;
  }

  async isBotSentProviderId(providerId: string): Promise<boolean> {
    const rows = await this.sql`
      select 1 from messages
      where provider_message_id = ${providerId} and direction = 'out'
      limit 1`;
    return rows.length > 0;
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return this.sql<Message[]>`
      select * from messages
      where conversation_id = ${conversationId}
      order by created_at asc`;
  }

  async countOutboundToCustomer(customerId: string): Promise<number> {
    const rows = await this.sql<{ count: string }[]>`
      select count(*)::text as count
      from messages m
      join conversations c on c.id = m.conversation_id
      where c.customer_id = ${customerId} and m.direction = 'out'`;
    return Number(rows[0]?.count ?? '0');
  }

  async recordLookup(input: Parameters<Store['recordLookup']>[0]): Promise<{ id: string }> {
    const rows = await this.sql<{ id: string }[]>`
      insert into part_lookups
        (conversation_id, year, make, model, part_type, wc_product_id,
         price_snapshot, warehouse, effective_qty, result)
      values
        (${input.conversationId}, ${input.year}, ${input.make}, ${input.model},
         ${input.partType}, ${input.wcProductId}, ${input.priceSnapshot},
         ${input.warehouse}, ${input.effectiveQty}, ${input.result})
      returning id`;
    return { id: rows[0]!.id };
  }

  async getActiveHoldQty(wcProductId: number): Promise<number> {
    // A hold counts only if it's active AND not yet past its expiry. The cron
    // flips expired holds to 'expired' only once a minute; the `expires_at`
    // check makes the count correct in the gap so we never over-report holds
    // and wrongly tell a customer an item is unavailable.
    const rows = await this.sql<{ total: string }[]>`
      select coalesce(sum(h.qty), 0)::text as total
      from holds h
      join part_lookups pl on pl.id = h.lookup_id
      where pl.wc_product_id = ${wcProductId}
        and h.status = 'active'
        and h.expires_at > now()`;
    return Number(rows[0]?.total ?? '0');
  }

  async getLatestFoundLookup(conversationId: string): Promise<{
    id: string; wcProductId: number; year: number; make: string; model: string; part: string;
  } | null> {
    const rows = await this.sql<
      { id: string; wc_product_id: string; year: number; make: string; model: string; part_type: string }[]
    >`
      select id, wc_product_id, year, make, model, part_type
      from part_lookups
      where conversation_id = ${conversationId}
        and result = 'found'
        and wc_product_id is not null
        and year is not null
        and make is not null
        and model is not null
        and part_type is not null
      order by created_at desc
      limit 1`;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          wcProductId: Number(row.wc_product_id),
          year: row.year,
          make: row.make,
          model: row.model,
          part: row.part_type,
        }
      : null;
  }

  async createHoldIfAvailable(
    input: Parameters<Store['createHoldIfAvailable']>[0],
  ): Promise<{ id: string } | null> {
    // Serialize concurrent hold attempts for the same product, then check
    // effective availability before inserting.
    return this.sql.begin(async (tx) => {
      // A transaction-scoped ADVISORY LOCK keyed on the product is the real
      // mutual exclusion here. Row locks (FOR UPDATE) alone do NOT protect the
      // last-unit case: when zero active holds exist there are no rows to lock,
      // so two concurrent transactions both read 0 held and both insert →
      // double-booking. The advisory lock has no such gap — it serializes on the
      // product id whether or not any hold rows exist, and auto-releases at
      // commit/rollback. Two conversations racing for the last unit now run
      // strictly one-after-another; the second sees the first's hold and is
      // rejected.
      await tx`select pg_advisory_xact_lock(${input.wcProductId})`;

      const held = await tx<{ qty: number }[]>`
        select coalesce(sum(h.qty), 0)::int as qty
        from holds h
        join part_lookups pl on pl.id = h.lookup_id
        where pl.wc_product_id = ${input.wcProductId}
          and h.status = 'active'
          and h.expires_at > now()`;
      const alreadyHeld = held[0]?.qty ?? 0;
      const effective = input.apiQty - alreadyHeld;
      if (effective < input.qty) return null;

      const inserted = await tx<{ id: string }[]>`
        insert into holds (lookup_id, qty, expires_at)
        values (${input.lookupId}, ${input.qty}, ${input.expiresAt})
        returning id`;
      return { id: inserted[0]!.id };
    });
  }

  async expireHolds(now: Date): Promise<number> {
    const rows = await this.sql`
      update holds set status = 'expired'
      where status = 'active' and expires_at <= ${now}
      returning id`;
    return rows.count;
  }

  async closeExpiredConversations(now: Date): Promise<number> {
    const rows = await this.sql`
      update conversations set status = 'closed'
      where status = 'open' and expires_at <= ${now}
      returning id`;
    return rows.count;
  }
}
