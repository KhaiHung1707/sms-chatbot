import { describe, it, expect } from 'vitest';
import { Pipeline } from '../src/core/pipeline.js';
import type { Config } from '../src/config.js';
import type { InboundMessage } from '../src/types.js';
import { MemoryStore } from './memoryStore.js';
import { ScriptedLlm, ThrowingLlm, SpyQuo, asQuo, type LlmStep } from './fakes.js';
import { MockInventoryClient, foundItem, skuItem } from './mocks.js';
import type { InventoryClient } from '../src/providers/inventory.js';
import type { InventorySearchOutcome } from '../src/providers/inventory.js';
import type { LlmClient } from '../src/llm/claude.js';

const CONFIG: Config = {
  ANTHROPIC_API_KEY: 'k',
  LLM_MODEL: 'claude-haiku-4-5',
  QUO_API_KEY: 'k',
  QUO_WEBHOOK_SECRET: 'k',
  QUO_PHONE_NUMBER: '+15104512800',
  INVENTORY_API_URL: 'https://example.com/wp-json/obp/v1',
  INVENTORY_API_KEY: 'k',
  DATABASE_URL: 'postgres://x',
  SHOP_TIMEZONE: 'America/Los_Angeles',
  SHOP_ADDRESS: '1911 Union St, Oakland',
  CONVERSATION_TTL_HOURS: 2,
  HOLD_EXPIRY_HOUR: 18,
  PORT: 3000,
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
};

function inbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    providerMessageId: `AC-${Math.random().toString(36).slice(2)}`,
    from: '+15105551234',
    to: '+15104512800',
    body: 'Hi',
    direction: 'incoming',
    hasMedia: false,
    userId: null,
    ...overrides,
  };
}

function build(opts: {
  llm: LlmClient;
  inventoryOutcome?: InventorySearchOutcome;
}) {
  const store = new MemoryStore();
  const quo = new SpyQuo();
  const inventory = new MockInventoryClient(
    opts.inventoryOutcome ?? { status: 'ok', results: [] },
  ) as unknown as InventoryClient;
  const pipeline = new Pipeline({ store, llm: opts.llm, quo: asQuo(quo), inventory, config: CONFIG });
  return { store, quo, pipeline };
}

describe('integration scenarios', () => {
  // 1. Happy path — one message with full info → one reply with the correct price.
  it('1. happy path: full info → reply contains the exact price', async () => {
    const llm = new ScriptedLlm([
      {
        kind: 'tool',
        name: 'search_inventory',
        input: { year: 1995, make: 'Honda', model: 'Accord', part: 'front bumper' },
        thenText: 'Front bumper for a 1995 Honda Accord is $129.95, 4 in stock. Pickup at 1911 Union St.',
      },
    ]);
    const rig = build({ llm, inventoryOutcome: { status: 'ok', results: [foundItem(129.95, 4)] } });
    await rig.pipeline.handleInbound(
      inbound({ body: '95 Accord front bumper, confirmed yes' }),
    );

    expect(rig.quo.sent).toHaveLength(1);
    expect(rig.quo.sent[0]!.content).toContain('129.95');
  });

  // 2. Three-turn follow-up (missing year → missing part → complete).
  it('2. multi-turn follow-up builds context and quotes on completion', async () => {
    const llm = new ScriptedLlm([
      { kind: 'text', text: 'Which year is the Accord, and front or rear bumper?' },
      { kind: 'text', text: 'Got it — front bumper for a 1995 Honda Accord? Reply yes to check price.' },
      {
        kind: 'tool',
        name: 'search_inventory',
        input: { year: 1995, make: 'Honda', model: 'Accord', part: 'front bumper' },
        thenText: 'It is $129.95, 4 in stock.',
      },
    ]);
    const rig = build({ llm, inventoryOutcome: { status: 'ok', results: [foundItem(129.95, 4)] } });
    const from = '+15105550001';

    await rig.pipeline.handleInbound(inbound({ from, body: 'Accord bumper' }));
    await rig.pipeline.handleInbound(inbound({ from, body: 'front' }));
    await rig.pipeline.handleInbound(inbound({ from, body: '95, yes' }));

    expect(rig.quo.sent).toHaveLength(3);
    expect(rig.quo.sent[2]!.content).toContain('129.95');
    // Per client feedback, replies do NOT carry a "Reply STOP" notice — they
    // should read like a natural text. STOP still works as an inbound keyword.
    expect(rig.quo.sent[0]!.content).not.toContain('STOP');
  });

  // 3. STOP mid-conversation.
  it('3. STOP opts out and no further message is ever answered', async () => {
    const llm = new ScriptedLlm([{ kind: 'text', text: 'Sure, which vehicle?' }]);
    const rig = build({ llm });
    const from = '+15105550002';

    await rig.pipeline.handleInbound(inbound({ from, body: 'STOP' }));
    // A later message must be ignored entirely (no send).
    await rig.pipeline.handleInbound(inbound({ from, body: 'Actually, Civic mirror?' }));

    // Only the STOP confirmation went out; the follow-up produced nothing.
    expect(rig.quo.sent).toHaveLength(1);
    expect(rig.quo.sent[0]!.content.toLowerCase()).toContain('unsubscribed');
  });

  // 4. Duplicate webhook (same provider_message_id twice) → only one reply.
  it('4. duplicate webhook produces only one reply', async () => {
    const llm = new ScriptedLlm([
      { kind: 'text', text: 'Which vehicle and part?' },
      { kind: 'text', text: 'SHOULD NOT SEND' },
    ]);
    const rig = build({ llm });
    const dup = inbound({ providerMessageId: 'DUP-1', body: 'hello' });

    await rig.pipeline.handleInbound(dup);
    await rig.pipeline.handleInbound(dup); // same id

    expect(rig.quo.sent).toHaveLength(1);
  });

  // 5. Inventory API returns 500 → reply contains no numbers.
  it('5. inventory api_error → bot stays SILENT (office handles it)', async () => {
    // Silence-first (Brandon #1): when the lookup fails, the model is not certain,
    // so it emits [[SILENT]] and the bot sends NOTHING.
    const llm = new ScriptedLlm([
      {
        kind: 'tool',
        name: 'search_inventory',
        input: { year: 1995, make: 'Honda', model: 'Accord', part: 'front bumper' },
        thenText: '[[SILENT]]',
      },
    ]);
    const rig = build({ llm, inventoryOutcome: { status: 'api_error', reason: 'http 500' } });

    await rig.pipeline.handleInbound(inbound({ body: '95 Accord front bumper yes' }));

    expect(rig.quo.sent).toHaveLength(0); // silent — nothing sent
    // The tool result handed to the model must itself contain no price.
    expect(llm.toolResults[0]).toContain('inventory_unavailable');
    expect(llm.toolResults[0]).not.toMatch(/\d+\.\d{2}/);
  });

  // 6. Staff takeover → bot goes silent.
  it('6. staff takeover marks handed_off and the bot stops replying', async () => {
    const llm = new ScriptedLlm([
      { kind: 'text', text: 'Which vehicle?' },
      { kind: 'text', text: 'SHOULD NOT SEND after handoff' },
    ]);
    const rig = build({ llm });
    const from = '+15105550003';

    // First message gets a normal reply.
    await rig.pipeline.handleInbound(inbound({ from, body: 'need a mirror' }));
    expect(rig.quo.sent).toHaveLength(1);

    // Staff replies in the Quo app → we flip the conversation to handed_off.
    const customer = await rig.store.getCustomerByPhone(from);
    const conv = await rig.store.getOpenConversation(customer!.id);
    await rig.store.setConversationStatus(conv!.id, 'handed_off');

    // A further customer message must be ignored by the bot.
    await rig.pipeline.handleInbound(inbound({ from, body: 'still there?' }));
    expect(rig.quo.sent).toHaveLength(1); // unchanged
  });
});

describe('robustness', () => {
  it('LLM failure → bot stays SILENT (no apology, office handles it)', async () => {
    // Silence-first: an internal error is not a confident answer, so send nothing.
    const rig = build({ llm: new ThrowingLlm() });
    await rig.pipeline.handleInbound(inbound({ body: 'price for a 95 Accord bumper?' }));
    expect(rig.quo.sent).toHaveLength(0);
  });

  it('[[SILENT]] sentinel → bot sends nothing', async () => {
    const rig = build({ llm: new ScriptedLlm([{ kind: 'text', text: '[[SILENT]]' }]) });
    await rig.pipeline.handleInbound(inbound({ body: 'civic bumper' }));
    expect(rig.quo.sent).toHaveLength(0);
  });

  it('empty reply → bot sends nothing', async () => {
    const rig = build({ llm: new ScriptedLlm([{ kind: 'text', text: '   ' }]) });
    await rig.pipeline.handleInbound(inbound({ body: 'hello' }));
    expect(rig.quo.sent).toHaveLength(0);
  });

  it('media-only message asks for the part in words (R-08)', async () => {
    const rig = build({ llm: new ScriptedLlm([]) });
    await rig.pipeline.handleInbound(inbound({ hasMedia: true, body: '' }));
    expect(rig.quo.sent).toHaveLength(1);
    // Friendly, no "call us"/"STOP"; asks for the part + vehicle.
    const reply = rig.quo.sent[0]!.content.toLowerCase();
    expect(reply).toContain('part');
    expect(reply).not.toContain('stop');
    expect(reply).not.toMatch(/call|phone/);
  });

  // Regression for Brandon's spam report: several photos (each a distinct
  // provider_message_id) must NOT trigger a burst of identical replies. The bot
  // asks once per conversation, then stays quiet on further photos.
  it('multiple photos get only ONE media reply per conversation', async () => {
    const rig = build({ llm: new ScriptedLlm([]) });
    const from = '+15105550099';
    await rig.pipeline.handleInbound(inbound({ from, hasMedia: true, body: '', providerMessageId: 'pic-1' }));
    await rig.pipeline.handleInbound(inbound({ from, hasMedia: true, body: '', providerMessageId: 'pic-2' }));
    await rig.pipeline.handleInbound(inbound({ from, hasMedia: true, body: '', providerMessageId: 'pic-3' }));
    expect(rig.quo.sent).toHaveLength(1); // asked once, not three times
  });

  // Regression (bugs H3 + M1): CONCURRENT messages from one customer must be
  // serialized. Three photos fired without awaiting (like the webhook's parallel
  // setImmediate) must still yield exactly ONE media reply and ONE conversation.
  it('concurrent photos from one customer → one reply, one conversation', async () => {
    const rig = build({ llm: new ScriptedLlm([]) });
    const from = '+15105550088';
    // Fire all three through handleMessage WITHOUT awaiting between them.
    await Promise.all([
      rig.pipeline.handleMessage(inbound({ from, direction: 'incoming', hasMedia: true, body: '', providerMessageId: 'c1' })),
      rig.pipeline.handleMessage(inbound({ from, direction: 'incoming', hasMedia: true, body: '', providerMessageId: 'c2' })),
      rig.pipeline.handleMessage(inbound({ from, direction: 'incoming', hasMedia: true, body: '', providerMessageId: 'c3' })),
    ]);
    expect(rig.quo.sent).toHaveLength(1); // per-phone lock prevented the spam burst
    const customer = await rig.store.getCustomerByPhone(from);
    const convCount = [...rig.store.conversations.values()].filter((c) => c.customer_id === customer!.id).length;
    expect(convCount).toBe(1); // no split conversation
  });
});

describe('Phase 2 — auto-handoff and language', () => {
  // Staff reply arrives as an OUTBOUND webhook carrying a userId → hand off,
  // no assertion on sends (the bot doesn't reply to outbound events).
  it('outbound with staff userId flips the conversation to handed_off', async () => {
    const llm = new ScriptedLlm([{ kind: 'text', text: 'Which vehicle?' }]);
    const rig = build({ llm });
    const from = '+15105550004';

    // Customer starts a conversation.
    await rig.pipeline.handleInbound(inbound({ from, body: 'need a mirror' }));
    const customer = await rig.store.getCustomerByPhone(from);
    const conv = await rig.store.getOpenConversation(customer!.id);
    expect(conv!.status).toBe('open');

    // Staff replies in the Quo app: outbound event, to=customer, with userId.
    await rig.pipeline.handleMessage(
      inbound({ direction: 'outgoing', from: '+15104512800', to: from, userId: 'USstaff1', body: 'On it' }),
    );

    const after = await rig.store.getOpenConversation(customer!.id);
    expect(after!.status).toBe('handed_off');
  });

  // Regression: after handoff, the customer's NEXT message must not revive the
  // bot. The bug was getOpenConversation filtering status='open' (not '<>closed'),
  // so a handed_off conversation looked absent → a fresh 'open' one was created →
  // the bot replied over the staff member. This drives the real code path
  // (handleMessage → getOrCreateConversation), not a direct status poke.
  it('after handoff, a further customer message keeps bot silent (no new conversation)', async () => {
    const llm = new ScriptedLlm([
      { kind: 'text', text: 'Which vehicle?' },
      { kind: 'text', text: 'SHOULD NOT SEND — staff owns this now' },
    ]);
    const rig = build({ llm });
    const from = '+15105550006';

    // 1. Customer opens the conversation; bot replies once.
    await rig.pipeline.handleMessage(inbound({ from, body: 'need a bumper' }));
    const customer = await rig.store.getCustomerByPhone(from);
    const conv = await rig.store.getOpenConversation(customer!.id);
    const sendsAfterFirst = rig.quo.sent.length;

    // 2. Staff replies manually (outbound, unknown provider id + staff userId).
    await rig.pipeline.handleMessage(
      inbound({ direction: 'outgoing', from: '+15104512800', to: from, userId: 'USstaff2', body: 'I got this' }),
    );
    expect((await rig.store.getOpenConversation(customer!.id))!.status).toBe('handed_off');

    // 3. Customer messages again → bot MUST stay silent and reuse the SAME
    //    (handed_off) conversation, not spawn a new open one.
    await rig.pipeline.handleMessage(inbound({ from, body: 'yes how much?' }));

    expect(rig.quo.sent.length).toBe(sendsAfterFirst); // no new bot reply
    const active = await rig.store.getOpenConversation(customer!.id);
    expect(active!.id).toBe(conv!.id); // same conversation, not a fresh one
    expect(active!.status).toBe('handed_off');
  });

  it("bot's own outbound echo (recorded provider id) does NOT trigger handoff", async () => {
    // Primary signal: the reply's Quo id was recorded on send. When that same
    // outbound echoes back as a webhook, isBotSentProviderId matches → ignored.
    const llm = new ScriptedLlm([{ kind: 'text', text: 'Which vehicle?' }]);
    const rig = build({ llm });
    const from = '+15105550005';
    await rig.pipeline.handleInbound(inbound({ from, body: 'hi' }));
    const customer = await rig.store.getCustomerByPhone(from);

    // The SpyQuo returns a stable id; it was recorded on the outbound message.
    const botMsg = rig.store.messages.find((m) => m.direction === 'out');
    expect(botMsg?.provider_message_id).toBeTruthy();

    await rig.pipeline.handleMessage(
      inbound({
        direction: 'outgoing', from: '+15104512800', to: from,
        providerMessageId: botMsg!.provider_message_id!, userId: null, body: 'Which vehicle?',
      }),
    );
    const conv = await rig.store.getOpenConversation(customer!.id);
    expect(conv!.status).toBe('open');
  });

  it('staff outbound with an UNKNOWN provider id triggers handoff', async () => {
    // A human replied in the Quo app: its provider id was never recorded by the
    // bot, so isBotSentProviderId is false → handoff.
    const llm = new ScriptedLlm([{ kind: 'text', text: 'Which vehicle?' }]);
    const rig = build({ llm });
    const from = '+15105550007';
    await rig.pipeline.handleInbound(inbound({ from, body: 'need a mirror' }));
    const customer = await rig.store.getCustomerByPhone(from);

    await rig.pipeline.handleMessage(
      inbound({
        direction: 'outgoing', from: '+15104512800', to: from,
        providerMessageId: 'AC-staff-typed-manually', userId: 'USstaff9', body: 'On it',
      }),
    );
    const after = await rig.store.getOpenConversation(customer!.id);
    expect(after!.status).toBe('handed_off');
  });

  it('persists a detected language and reuses it', async () => {
    const llm = new ScriptedLlm([
      { kind: 'text', text: 'Chào bạn, xe gì và phụ tùng nào?' },
      { kind: 'text', text: 'ok' },
    ]);
    const rig = build({ llm });
    const from = '+15105550006';

    await rig.pipeline.handleInbound(inbound({ from, body: 'cần cản trước cho Accord' }));
    const customer = await rig.store.getCustomerByPhone(from);
    expect(customer!.language).toBe('vi');

    // A follow-up bare "95" must NOT overwrite the stored 'vi'.
    await rig.pipeline.handleInbound(inbound({ from, body: '95' }));
    const after = await rig.store.getCustomerByPhone(from);
    expect(after!.language).toBe('vi');
  });
});

describe('Update 001 — hold confirmed in a SEPARATE turn from the search', () => {
  // Regression: a real LLM often searches on one turn and calls create_hold on
  // a LATER turn (with no product_id — the schema no longer asks for one). The
  // pipeline must recover the product from the conversation's latest found
  // lookup and still create the hold. Earlier this silently failed (the in-turn
  // closure was null on the hold turn), so the bot claimed a hold that never
  // reached the DB.
  it('creates the hold from the recovered lookup, no product_id needed', async () => {
    const from = '+15105550777';

    // Turn 1: customer confirms → LLM searches (records a 'found' lookup).
    const rig = build({
      llm: new ScriptedLlm([
        {
          kind: 'tool',
          name: 'search_inventory',
          input: { year: 1998, make: 'Honda', model: 'Civic', part: 'left mirror' },
          thenText: '$42.50, 1 left as of right now. Want me to hold it?',
        },
      ]),
      inventoryOutcome: { status: 'ok', results: [foundItem(42.5, 1)] },
    });
    await rig.pipeline.handleInbound(inbound({ from, body: '98 Civic left mirror yes' }));

    // Turn 2 (new closure): customer says "hold it" → LLM calls create_hold
    // with NO product_id. Reuse the same store/inventory so the lookup persists.
    const holdLlm = new ScriptedLlm([
      { kind: 'tool', name: 'create_hold', input: { qty: 1 }, thenText: 'Held until 6 PM ✓' },
    ]);
    const pipeline2 = new Pipeline({
      store: rig.store,
      llm: holdLlm,
      quo: asQuo(rig.quo),
      inventory: new MockInventoryClient({ status: 'ok', results: [foundItem(42.5, 1)] }) as unknown as InventoryClient,
      config: CONFIG,
    });
    await pipeline2.handleInbound(inbound({ from, body: 'yes hold it' }));

    // The hold must actually exist for the product, reserving the last unit.
    expect(await rig.store.getActiveHoldQty(48213)).toBe(1);
  });
});

describe('SKU / part-number lookup (Brandon)', () => {
  it('customer texts a SKU → bot quotes it via lookup_sku', async () => {
    const llm = new ScriptedLlm([
      {
        kind: 'tool',
        name: 'lookup_sku',
        input: { sku: 'GM1000683' },
        thenText:
          'FRONT BUMPER COVER\nSKU: GM1000683\nPrice: $115.30\nStatus: In Stock',
      },
    ]);
    const rig = build({
      llm,
      inventoryOutcome: { status: 'ok', results: [skuItem(115.3, 4)] },
    });
    await rig.pipeline.handleInbound(inbound({ body: 'GM1000683' }));
    expect(rig.quo.sent).toHaveLength(1);
    expect(rig.quo.sent[0]!.content).toContain('GM1000683');
    expect(rig.quo.sent[0]!.content).toContain('115.30');
  });

  it('lookup_sku result feeds the model the features + fitments', async () => {
    // Capture what the tool hands back to the model so the reply template can
    // include features/fits. We assert on the tool result via a second turn.
    const llm = new ScriptedLlm([
      { kind: 'tool', name: 'lookup_sku', input: { sku: 'GM1000683' }, thenText: 'ok' },
    ]);
    const rig = build({
      llm,
      inventoryOutcome: { status: 'ok', results: [skuItem(115.3, 4)] },
    });
    await rig.pipeline.handleInbound(inbound({ body: 'part number GM1000683' }));
    const toolResult = (llm as unknown as { toolResults: string[] }).toolResults[0]!;
    expect(toolResult).toContain('For Ss Model');
    expect(toolResult).toContain('Primed/Paint To Match');
    expect(toolResult).toContain('silverado');
  });

  it('hold after a SKU quote reserves the product (SKU hold-continuity)', async () => {
    const from = '+15105550909';
    // Turn 1: SKU lookup records a found lookup with sku set.
    const rig = build({
      llm: new ScriptedLlm([
        { kind: 'tool', name: 'lookup_sku', input: { sku: 'GM1000683' }, thenText: '$115.30, in stock. Want me to hold it?' },
      ]),
      inventoryOutcome: { status: 'ok', results: [skuItem(115.3, 1)] },
    });
    await rig.pipeline.handleInbound(inbound({ from, body: 'GM1000683' }));

    // Turn 2 (new closure): "hold it" — must recover the SKU and reserve.
    const holdLlm = new ScriptedLlm([
      { kind: 'tool', name: 'create_hold', input: { qty: 1 }, thenText: 'Held ✓' },
    ]);
    const pipeline2 = new Pipeline({
      store: rig.store,
      llm: holdLlm,
      quo: asQuo(rig.quo),
      inventory: new MockInventoryClient(
        { status: 'ok', results: [] },
        { status: 'ok', results: [skuItem(115.3, 1)] }, // SKU re-read
      ) as unknown as InventoryClient,
      config: CONFIG,
    });
    await pipeline2.handleInbound(inbound({ from, body: 'yes hold it' }));
    expect(await rig.store.getActiveHoldQty(48213)).toBe(1);
  });
});
