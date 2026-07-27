import type { Config } from '../config.js';
import type { Store } from '../db/store.js';
import type { LlmClient } from '../llm/claude.js';
import { toClaudeHistory } from '../llm/claude.js';
import type { InventoryClient } from '../providers/inventory.js';
import type { QuoClient } from '../providers/quo.js';
import { OutOfCreditError } from '../providers/quo.js';
import {
  executeSearchInventory,
  executeLookupSku,
  searchInventorySchema,
  createHoldSchema,
  lookupSkuSchema,
  type SearchInventoryInput,
} from '../llm/tools.js';
import { buildSystemPrompt } from '../llm/systemPrompt.js';
import { computeHoldExpiry } from '../jobs/holdTime.js';
import { decideIntake, detectKeyword } from './guards.js';
import { detectLanguageHint } from './language.js';
import { ConversationManager } from './conversation.js';
import { logger } from '../logger.js';
import type { InboundMessage } from '../types.js';

/**
 * Orchestrator: webhook → guards → keyword handling → LLM loop → reply.
 * All external services are injected so the whole flow is testable offline.
 */
export interface PipelineDeps {
  store: Store;
  llm: LlmClient;
  quo: QuoClient;
  inventory: InventoryClient;
  config: Config;
}

const MEDIA_REPLY =
  "Thanks for the pic! I can't open photos here — mind telling me the part plus the year, make, and model? Happy to look it up.";
const HELP_REPLY_TEMPLATE = (address: string) =>
  `Oakland Body Parts, ${address}. Just text me the part and your vehicle and I'll help you find it.`;
const STOP_REPLY = "You're unsubscribed and won't get more texts. Text HELP anytime if you need us.";

// The model emits this sentinel only when the office has taken over (or there is
// truly nothing helpful to say/ask). The bot is helpful by default — it answers
// at ~80%+ confidence and asks follow-ups otherwise; silence is the exception.
const SILENT_SENTINEL = '[[SILENT]]';

/** True if the agent's reply means "stay silent" — the sentinel or empty text. */
function isSilent(reply: string): boolean {
  const t = reply.trim();
  if (t === '') return true;
  // Tolerate case/whitespace variants and the sentinel appearing alone.
  const normalized = t.toUpperCase().replace(/\s+/g, '');
  return normalized === SILENT_SENTINEL.toUpperCase() || normalized.includes('[[SILENT]]');
}

/** The only domain the bot is ever allowed to link to. */
const ALLOWED_LINK_HOST = 'oaklandbodyparts.com';

/**
 * Safety net against link hallucination: the model has sent customers wrong links
 * (e.g. a fabricated ebay.com/itm/<sku>). We NEVER want to send a customer to a
 * competitor. This strips any http(s) URL whose host is not oaklandbodyparts.com
 * from an outbound reply, and tidies leftover "Order link:" labels.
 */
export function stripForeignLinks(text: string): string {
  let stripped = text.replace(/https?:\/\/[^\s]+/gi, (url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      const ok = host === ALLOWED_LINK_HOST || host.endsWith(`.${ALLOWED_LINK_HOST}`);
      return ok ? url : '';
    } catch {
      return ''; // unparseable → drop it
    }
  });
  // Clean up an "Order:"/"Order link:" line left dangling with no URL after it.
  stripped = stripped
    .replace(/^[ \t]*Order(?:\s+link)?:[ \t]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return stripped;
}

export class Pipeline {
  private readonly conversations: ConversationManager;

  // Per-phone serialization. The webhook fans out concurrent setImmediate runs,
  // so two messages from the same customer (or a Quo retry) could interleave and
  // (a) create two open conversations, (b) both pass the media "ask once" guard,
  // (c) reply after an opt-out that a later message set. Chaining each phone's
  // work onto a promise makes all messages from one customer run STRICTLY in
  // order, closing those races. Different phones still run concurrently.
  private readonly phoneLocks = new Map<string, Promise<void>>();

  // Cache of the live editable instruction steps. Loaded lazily on the first
  // reply and reused; the admin page calls refreshInstructions() after a
  // publish/rollback so the change takes effect without a restart. undefined =
  // not loaded yet; null = loaded but table empty/unreachable → use defaults.
  private liveSteps: readonly string[] | null | undefined = undefined;

  constructor(private readonly deps: PipelineDeps) {
    this.conversations = new ConversationManager(
      deps.store,
      deps.config.CONVERSATION_TTL_HOURS,
    );
  }

  /**
   * The live editable conversation-flow steps, memoized. Falls back to the code
   * default (buildSystemPrompt uses DEFAULT_INSTRUCTION_STEPS when given
   * undefined) if the table is empty or the read fails — so a DB hiccup NEVER
   * breaks a reply. Never throws.
   */
  private async getLiveSteps(): Promise<readonly string[] | undefined> {
    if (this.liveSteps !== undefined) {
      return this.liveSteps ?? undefined;
    }
    try {
      const live = await this.deps.store.getLiveInstructions();
      this.liveSteps = live && live.steps.length > 0 ? live.steps : null;
    } catch (err) {
      logger.error({ err }, 'failed to load live instructions; using code defaults');
      this.liveSteps = null;
    }
    return this.liveSteps ?? undefined;
  }

  /** Called by the admin page after publish/rollback so the change takes effect. */
  refreshInstructions(): void {
    this.liveSteps = undefined;
  }

  /** Run `fn` after any in-flight work for `phone`, serializing per phone. */
  private async withPhoneLock(phone: string, fn: () => Promise<void>): Promise<void> {
    const prior = this.phoneLocks.get(phone) ?? Promise.resolve();
    // Chain onto the prior work; swallow its error so one failure doesn't break
    // the chain for subsequent messages.
    const run = prior.catch(() => {}).then(fn);
    this.phoneLocks.set(phone, run);
    try {
      await run;
    } finally {
      // Clean up only if we're still the tail (no newer message chained on).
      if (this.phoneLocks.get(phone) === run) {
        this.phoneLocks.delete(phone);
      }
    }
  }

  /**
   * Entry point for any Quo message webhook. Routes inbound customer messages
   * to the agent, and outbound messages to handoff detection.
   *
   * For an outbound event, `from` is the shop number and `to` is the customer,
   * so we look up the customer by the `to` field.
   */
  async handleMessage(msg: InboundMessage): Promise<void> {
    // Serialize per customer phone: inbound → `from`, outbound → `to`. This
    // prevents interleaving that would split conversations or double-reply.
    const customerPhone = msg.direction === 'outgoing' ? msg.to : msg.from;
    await this.withPhoneLock(customerPhone, async () => {
      if (msg.direction === 'outgoing') {
        await this.handleOutbound(msg);
        return;
      }
      await this.handleInbound(msg);
    });
  }

  /**
   * Staff-takeover detection (R-06, C-01). A staff member replying manually in
   * the Quo app produces an OUTBOUND webhook. We must tell that apart from the
   * bot's OWN outbound (which also fires a webhook).
   *
   * Primary signal — the one we control: every SMS the bot sends records the
   * Quo message id (see reply()). If this outbound's provider id is one we
   * recorded, it's the bot's own message → ignore. If it's NOT, a human sent it
   * → hand the conversation off. This does not depend on guessing `userId`,
   * whose exact shape on `message.delivered` is unverified against Quo (see
   * MANUAL_TASKS — capture a real payload to confirm the userId fallback).
   */
  async handleOutbound(msg: InboundMessage): Promise<void> {
    // Bot-sent messages carry a provider id we recorded on send.
    if (msg.providerMessageId) {
      const botSent = await this.deps.store.isBotSentProviderId(msg.providerMessageId);
      if (botSent) return; // our own reply echoing back — not a takeover
    }

    // A genuine STAFF takeover is a human replying in the Quo app, which carries
    // a userId. If there's NO userId, this outbound is almost certainly the bot's
    // own send whose id we failed to record (e.g. Quo returned an empty id on
    // send — H2). Treating that as a takeover would wrongly silence the bot on a
    // live customer, so we require a userId before handing off.
    if (!msg.userId) {
      logger.info(
        { to: msg.to, id: msg.providerMessageId },
        'outbound with no staff userId and unrecognized id — treating as bot-sent, not a takeover',
      );
      return;
    }

    // `to` is the customer on an outbound message.
    const customer = await this.deps.store.getCustomerByPhone(msg.to);
    if (!customer) return;
    const conversation = await this.deps.store.getOpenConversation(customer.id);
    if (!conversation || conversation.status === 'handed_off') return;

    await this.conversations.markHandedOff(conversation.id);
    logger.info(
      { conversation: conversation.id, staff: msg.userId },
      'staff takeover detected; conversation handed off',
    );
  }

  async handleInbound(msg: InboundMessage): Promise<void> {
    const { store } = this.deps;

    const customer = await this.conversations.getOrCreateCustomer(msg.from);

    // Fail-safe intake gate (R-06, R-08, R-15).
    const decision = decideIntake(msg, {
      isOptedOut: customer.opted_out,
      botUserId: null,
    });
    if (decision.action === 'ignore') {
      logger.info({ reason: decision.reason, id: msg.providerMessageId }, 'ignored');
      return;
    }

    const conversation = await this.conversations.getOrCreateConversation(customer.id);

    // Dedupe on insert (R-10): a repeated webhook cannot produce a second reply.
    const inserted = await store.insertInboundMessage(
      conversation.id,
      msg.body,
      msg.providerMessageId,
    );
    if (!inserted) {
      logger.info({ id: msg.providerMessageId }, 'duplicate webhook, skipped');
      return;
    }

    // Media-only message → ask for a text description, but ONLY ONCE per
    // conversation. A customer sending several photos (or Quo retrying the
    // webhook) produced a burst of identical replies — the spam Brandon saw.
    // Dedupe-on-insert doesn't catch it because each photo is a distinct
    // provider_message_id, so we guard on whether we've already sent the media
    // prompt in this conversation.
    if (decision.action === 'reply_media_unsupported') {
      const priorMessages = await store.getMessages(conversation.id);
      const alreadyAsked = priorMessages.some(
        (m) => m.direction === 'out' && m.body === MEDIA_REPLY,
      );
      if (!alreadyAsked && conversation.status !== 'handed_off') {
        await this.reply(customer.id, customer.phone, conversation.id, MEDIA_REPLY);
      }
      return;
    }

    // Staff has taken over → bot stays silent (R-06).
    if (conversation.status === 'handed_off') {
      logger.info({ conversation: conversation.id }, 'handed off; bot silent');
      return;
    }

    // STOP / HELP keywords take precedence over the LLM.
    const keyword = detectKeyword(msg.body);
    if (keyword === 'stop') {
      await store.setOptedOut(customer.id, true);
      await this.reply(customer.id, customer.phone, conversation.id, STOP_REPLY);
      return;
    }
    if (keyword === 'help') {
      await this.reply(
        customer.id,
        customer.phone,
        conversation.id,
        HELP_REPLY_TEMPLATE(this.deps.config.SHOP_ADDRESS),
      );
      return;
    }

    // Persist a language hint for the dashboard and cross-turn consistency
    // (Phase 2). Only update when a clear signal exists — a bare "yes"/"95"
    // must not overwrite a previously detected language.
    const hint = detectLanguageHint(msg.body);
    let knownLanguage: string = customer.language;
    if (hint && hint !== customer.language) {
      await store.setLanguage(customer.id, hint);
      knownLanguage = hint;
    }

    await this.runAgent(customer.id, customer.phone, conversation.id, knownLanguage);
  }

  /** Run the Claude tool loop and send its reply. */
  private async runAgent(
    customerId: string,
    phone: string,
    conversationId: string,
    knownLanguage: string,
  ): Promise<void> {
    const history = await this.deps.store.getMessages(conversationId);
    const claudeHistory = toClaudeHistory(history);

    const steps = await this.getLiveSteps();
    const system = buildSystemPrompt({
      shopAddress: this.deps.config.SHOP_ADDRESS,
      holdExpiryHour: this.deps.config.HOLD_EXPIRY_HOUR,
      knownLanguage,
      steps,
    });

    const executeTool = this.buildToolExecutor(conversationId);

    let reply: string;
    try {
      const result = await this.deps.llm.runTurn(system, claudeHistory, executeTool);
      reply = result.reply.trim();
    } catch (err) {
      // A hard internal error (LLM crash) — we can't produce a good reply, so send
      // nothing and let the office pick it up rather than emit garbage.
      logger.error({ err }, 'llm turn failed; sending nothing');
      return;
    }

    // Brandon #1 (revised): the bot is HELPFUL by default — it answers when ~80%+
    // confident and asks follow-up questions when unsure. It only goes silent when
    // the office has taken over (the model emits [[SILENT]] then, or on a handed-off
    // conversation). An empty/[[SILENT]] reply means "stay silent" → send nothing.
    if (isSilent(reply)) {
      logger.info({ conversation: conversationId }, 'model signaled silence (office handling)');
      return;
    }

    // Re-check opt-out right before sending (M2/TCPA): the agent turn can take
    // seconds, during which the customer may have sent STOP. Never send a reply
    // to someone who opted out in the meantime.
    const current = await this.deps.store.getCustomerByPhone(phone);
    if (current?.opted_out) {
      logger.info({ customer: customerId }, 'customer opted out during agent turn; suppressing reply');
      return;
    }

    // Safety net: never send a customer a link to any site other than
    // oaklandbodyparts.com (the model has hallucinated eBay links from a SKU).
    const safe = stripForeignLinks(reply);
    if (safe !== reply) {
      logger.warn({ conversation: conversationId }, 'stripped a non-shop link from the reply');
    }
    if (isSilent(safe)) {
      // Stripping left nothing meaningful → stay silent rather than send junk.
      return;
    }

    await this.reply(customerId, phone, conversationId, safe);
  }

  /**
   * Build the tool executor bound to this conversation. Records every lookup to
   * part_lookups (audit) and enforces that create_hold only runs after a
   * successful lookup produced a real product_id.
   */
  private buildToolExecutor(conversationId: string) {
    // Track the most recent successful lookup within THIS turn so create_hold
    // can reference the same product. Across turns, we fall back to the DB
    // (getLatestFoundLookup) since a fresh closure starts null each message.
    let lastLookupId: string | null = null;
    let lastProductId: number | null = null;
    let lastSearchParams: SearchInventoryInput | null = null;
    let lastSku: string | null = null; // set when the prior lookup was by SKU

    return async (name: string, input: unknown): Promise<string> => {
      if (name === 'search_inventory') {
        // Validate the model's tool input; a malformed call must not send
        // "undefined" params to the API (which would falsely report not-found).
        const parsed = searchInventorySchema.safeParse(input);
        if (!parsed.success) {
          logger.warn({ input }, 'search_inventory: invalid tool input');
          return JSON.stringify({
            error: 'invalid_input',
            message: 'The vehicle details are incomplete. Ask the customer for the year, make, model, and part.',
          });
        }
        const params = parsed.data;
        const exec = await executeSearchInventory(
          this.deps.inventory,
          params,
          (productId) => this.deps.store.getActiveHoldQty(productId),
        );
        const lookup = await this.deps.store.recordLookup({
          conversationId,
          year: params.year,
          make: params.make,
          model: params.model,
          partType: params.part,
          wcProductId: exec.firstProductId,
          priceSnapshot: exec.firstPrice,
          warehouse: exec.firstWarehouse,
          // Audit the hold-adjusted qty the customer was actually told about.
          effectiveQty: exec.firstEffectiveQty,
          result: exec.lookupResult,
        });
        lastLookupId = lookup.id;
        lastProductId = exec.firstProductId;
        lastSearchParams = params;
        lastSku = null;
        return exec.toolResult;
      }

      if (name === 'lookup_sku') {
        const parsed = lookupSkuSchema.safeParse(input);
        if (!parsed.success) {
          logger.warn({ input }, 'lookup_sku: invalid tool input');
          return JSON.stringify({
            error: 'invalid_input',
            message: "That doesn't look like a valid part number. Ask the customer to re-check the SKU.",
          });
        }
        const sku = parsed.data.sku;
        const exec = await executeLookupSku(
          this.deps.inventory,
          sku,
          (productId) => this.deps.store.getActiveHoldQty(productId),
        );
        // Record the lookup (ymm fields null — this was a SKU lookup) so a hold
        // confirmed in a later turn can recover the product.
        const lookup = await this.deps.store.recordLookup({
          conversationId,
          year: null,
          make: null,
          model: null,
          partType: null,
          wcProductId: exec.firstProductId,
          priceSnapshot: exec.firstPrice,
          warehouse: exec.firstWarehouse,
          effectiveQty: exec.firstEffectiveQty,
          result: exec.lookupResult,
          sku,
        });
        lastLookupId = lookup.id;
        lastProductId = exec.firstProductId;
        lastSearchParams = null;
        lastSku = exec.firstProductId ? sku : null;
        return exec.toolResult;
      }

      if (name === 'create_hold') {
        // Validate: block a nonsensical qty (a negative would always pass the
        // availability check `effective < qty` and reserve garbage).
        const parsedHold = createHoldSchema.safeParse(input);
        if (!parsedHold.success) {
          logger.warn({ input }, 'create_hold: invalid tool input');
          return JSON.stringify({ held: false, reason: 'invalid_input', message: 'Ask the customer to confirm which part and how many.' });
        }
        const params = parsedHold.data;
        const wantProduct = params.product_id ?? lastProductId;

        // The customer often confirms a hold in a SEPARATE message from the
        // search, so this turn's closure vars may be null. Recover context from
        // the conversation's most recent 'found' lookup (product + search params).
        const recent = await this.deps.store.getLatestFoundLookup(conversationId);
        // Rebuild ymm search params only if the recovered lookup has full ymm
        // (a SKU-only lookup has null ymm — it's re-read via SKU instead).
        const recentYmm =
          recent && recent.year !== null && recent.make !== null &&
          recent.model !== null && recent.part !== null
            ? { year: recent.year, make: recent.make, model: recent.model, part: recent.part }
            : null;
        const searchParams: SearchInventoryInput | null = lastSearchParams ?? recentYmm;
        const productId = wantProduct ?? recent?.wcProductId ?? null;
        const lookupId = lastLookupId ?? recent?.id ?? null;
        // A SKU lookup has no ymm search params, so recover the SKU: this turn's
        // lastSku, or the recovered lookup's sku (a SKU-only lookup has null ymm).
        const skuToReread = lastSku ?? (searchParams ? null : recent?.sku ?? null);

        if (productId === null || lookupId === null || (!searchParams && !skuToReread)) {
          return JSON.stringify({
            held: false,
            reason: 'no_prior_lookup',
            message:
              "I don't have a part to hold yet. Ask the customer which part they'd like to hold.",
          });
        }

        // Update 001: read FRESH stock for this product right before holding —
        // the warehouse sells all day, so the earlier snapshot may be stale.
        // Re-read via SKU if the prior lookup was by SKU, else via ymm search.
        const outcome = skuToReread
          ? await this.deps.inventory.lookupBySku(skuToReread)
          : await this.deps.inventory.search(searchParams!);
        if (outcome.status !== 'ok') {
          return JSON.stringify({
            held: false,
            reason: 'inventory_unavailable',
            message:
              "I can't confirm that item right now — a staff member will follow up. State no numbers.",
          });
        }
        const match = outcome.results.find((r) => r.product_id === productId);
        const freshApiQty = match
          ? match.inventory.reduce((sum, w) => sum + w.qty, 0)
          : 0;

        const expiresAt = computeHoldExpiry(
          new Date(),
          this.deps.config.SHOP_TIMEZONE,
          this.deps.config.HOLD_EXPIRY_HOUR,
        );
        // Atomic (Rule 2): succeeds only if fresh api qty − active holds allows.
        const hold = await this.deps.store.createHoldIfAvailable({
          lookupId,
          wcProductId: productId,
          apiQty: freshApiQty,
          qty: params.qty ?? 1,
          expiresAt,
        });
        if (!hold) {
          return JSON.stringify({
            held: false,
            reason: 'no_longer_available',
            message:
              'That item is no longer available to hold — it may have just been sold or reserved. Tell the customer honestly and suggest alternatives if any.',
          });
        }
        return JSON.stringify({ held: true, hold_id: hold.id, expires_at: expiresAt.toISOString() });
      }

      return JSON.stringify({ error: `unknown tool: ${name}` });
    };
  }

  /**
   * Persist and send an outbound reply.
   *
   * Per client (Brandon) feedback we do NOT append "Reply STOP to opt out" to
   * messages — it reads as robotic. STOP/HELP keywords still WORK if a customer
   * sends them (see handleInbound), which keeps the opt-out path functional; we
   * just don't advertise it in every message. `opts` retained for call sites.
   */
  private async reply(
    _customerId: string,
    phone: string,
    conversationId: string,
    body: string,
  ): Promise<void> {
    const text = body;

    // Persist first so we have a row to attach the Quo id to. If the send fails,
    // we DELETE the row (below) so an undelivered reply never re-enters history.
    const outbound = await this.deps.store.insertOutboundMessage(conversationId, text);

    try {
      const sent = await this.deps.quo.sendMessage(phone, text);
      // Record the Quo id so a later outbound webhook for THIS message is
      // recognized as bot-sent, not a staff reply (C-01 auto-handoff).
      if (sent.id) {
        await this.deps.store.setOutboundProviderId(outbound.id, sent.id);
      } else {
        // Quo accepted the send but returned no id. We can't recognize this
        // message's delivery webhook as our own, so the auto-handoff check would
        // misread it as a staff takeover and silence the bot. Log loudly; the
        // message WAS sent, so we keep the row (don't delete), but flag the gap.
        logger.warn(
          { conversation: conversationId },
          'Quo send returned no message id — delivery webhook for this reply may be misread as staff takeover',
        );
      }
    } catch (err) {
      if (err instanceof OutOfCreditError) {
        logger.error({ err }, 'CRITICAL: Quo out of credit; message failed');
      } else {
        logger.error({ err }, 'quo send failed');
      }
      // H1 fix: the SMS did NOT go out. Remove the outbound row so the LLM never
      // treats an undelivered reply as already-said on the next turn.
      await this.deps.store.deleteMessage(outbound.id);
    }
  }
}

export type { InboundMessage };
