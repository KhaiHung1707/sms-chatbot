import type { Config } from '../config.js';
import type { Store } from '../db/store.js';
import type { LlmClient } from '../llm/claude.js';
import { toClaudeHistory } from '../llm/claude.js';
import type { InventoryClient } from '../providers/inventory.js';
import type { QuoClient } from '../providers/quo.js';
import { OutOfCreditError } from '../providers/quo.js';
import {
  executeSearchInventory,
  type CreateHoldInput,
  type SearchInventoryInput,
} from '../llm/tools.js';
import { buildSystemPrompt, OPT_OUT_NOTICE } from '../llm/systemPrompt.js';
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
  "I can't view photos yet — could you describe the part and your vehicle's year/make/model?";
const HELP_REPLY_TEMPLATE = (address: string) =>
  `Oakland Body Parts — ${address}. Call us for help. Reply STOP to opt out.`;
const STOP_REPLY = 'You have been unsubscribed. Reply HELP for contact info.';
const API_ERROR_REPLY =
  "I can't look that up right now — a staff member will follow up shortly.";

export class Pipeline {
  private readonly conversations: ConversationManager;

  constructor(private readonly deps: PipelineDeps) {
    this.conversations = new ConversationManager(
      deps.store,
      deps.config.CONVERSATION_TTL_HOURS,
    );
  }

  /**
   * Entry point for any Quo message webhook. Routes inbound customer messages
   * to the agent, and outbound messages to handoff detection.
   *
   * For an outbound event, `from` is the shop number and `to` is the customer,
   * so we look up the customer by the `to` field.
   */
  async handleMessage(msg: InboundMessage): Promise<void> {
    if (msg.direction === 'outgoing') {
      await this.handleOutbound(msg);
      return;
    }
    await this.handleInbound(msg);
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
    } else if (msg.userId === null) {
      // No provider id AND no staff user → treat as the bot's own; ignore.
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

    // Media-only message → ask for a text description.
    if (decision.action === 'reply_media_unsupported') {
      await this.reply(customer.id, customer.phone, conversation.id, MEDIA_REPLY);
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
      await this.reply(customer.id, customer.phone, conversation.id, STOP_REPLY, {
        skipOptOutNotice: true,
      });
      return;
    }
    if (keyword === 'help') {
      await this.reply(
        customer.id,
        customer.phone,
        conversation.id,
        HELP_REPLY_TEMPLATE(this.deps.config.SHOP_ADDRESS),
        { skipOptOutNotice: true },
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

    const system = buildSystemPrompt({
      shopAddress: this.deps.config.SHOP_ADDRESS,
      holdExpiryHour: this.deps.config.HOLD_EXPIRY_HOUR,
      knownLanguage,
    });

    const executeTool = this.buildToolExecutor(conversationId);

    let reply: string;
    try {
      const result = await this.deps.llm.runTurn(system, claudeHistory, executeTool);
      reply = result.reply.trim() || API_ERROR_REPLY;
    } catch (err) {
      logger.error({ err }, 'llm turn failed');
      reply = API_ERROR_REPLY;
    }

    await this.reply(customerId, phone, conversationId, reply);
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

    return async (name: string, input: unknown): Promise<string> => {
      if (name === 'search_inventory') {
        const params = input as SearchInventoryInput;
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
        return exec.toolResult;
      }

      if (name === 'create_hold') {
        const params = input as CreateHoldInput;
        const wantProduct = params.product_id ?? lastProductId;

        // The customer often confirms a hold in a SEPARATE message from the
        // search, so this turn's closure vars may be null. Recover context from
        // the conversation's most recent 'found' lookup (product + search params).
        const recent = await this.deps.store.getLatestFoundLookup(conversationId);
        const searchParams =
          lastSearchParams ??
          (recent
            ? { year: recent.year, make: recent.make, model: recent.model, part: recent.part }
            : null);
        const productId = wantProduct ?? recent?.wcProductId ?? null;
        const lookupId = lastLookupId ?? recent?.id ?? null;

        if (productId === null || lookupId === null || !searchParams) {
          return JSON.stringify({
            held: false,
            reason: 'no_prior_lookup',
            message:
              "I don't have a part to hold yet. Ask the customer which part they'd like to hold.",
          });
        }

        // Update 001: read FRESH stock for this product right before holding —
        // the warehouse sells all day, so the earlier search snapshot may be
        // stale. Re-run the search and take the matching product's on-hand qty.
        const outcome = await this.deps.inventory.search(searchParams);
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
   * Persist and send an outbound reply, appending the opt-out notice on the
   * first ever message to this customer. The phone is threaded from intake, so
   * no extra lookup is needed.
   */
  private async reply(
    customerId: string,
    phone: string,
    conversationId: string,
    body: string,
    opts: { skipOptOutNotice?: boolean } = {},
  ): Promise<void> {
    let text = body;
    if (!opts.skipOptOutNotice) {
      const priorOutbound = await this.deps.store.countOutboundToCustomer(customerId);
      if (priorOutbound === 0) {
        text = `${body} ${OPT_OUT_NOTICE}`.trim();
      }
    }

    // Persist first so a send failure doesn't lose the record.
    const outbound = await this.deps.store.insertOutboundMessage(conversationId, text);

    try {
      const sent = await this.deps.quo.sendMessage(phone, text);
      // Record the Quo id so a later outbound webhook for THIS message is
      // recognized as bot-sent, not a staff reply (C-01 auto-handoff).
      if (sent.id) {
        await this.deps.store.setOutboundProviderId(outbound.id, sent.id);
      }
    } catch (err) {
      if (err instanceof OutOfCreditError) {
        logger.error({ err }, 'CRITICAL: Quo out of credit; message failed');
      } else {
        logger.error({ err }, 'quo send failed');
      }
    }
  }
}

export type { InboundMessage };
