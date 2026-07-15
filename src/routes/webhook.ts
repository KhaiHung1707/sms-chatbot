import { Hono } from 'hono';
import type { Config } from '../config.js';
import type { Pipeline } from '../core/pipeline.js';
import { logger } from '../logger.js';
import {
  verifyQuoSignature,
  parseInboundMessage,
  SIGNATURE_HEADER,
} from '../providers/quo.js';

/**
 * POST /webhooks/quo
 *
 * Contract (R-19): verify signature on the RAW body, then return 200 in <1s.
 * The LLM work runs asynchronously (setImmediate) so the webhook never waits on
 * Claude or the Inventory API — Quo would otherwise time out and retry.
 *
 * Dedupe by provider_message_id (R-10) happens at the DB insert layer inside
 * the pipeline; the route just verifies, parses, and hands off.
 */
export function createWebhookRoute(config: Config, pipeline: Pipeline): Hono {
  const app = new Hono();

  app.post('/webhooks/quo', async (c) => {
    // Read the RAW body first — signature is computed over exact bytes.
    const rawBody = await c.req.text();
    const signature = c.req.header(SIGNATURE_HEADER);

    if (!verifyQuoSignature(rawBody, signature, config.QUO_WEBHOOK_SECRET)) {
      logger.warn('rejected webhook: invalid signature');
      return c.json({ error: 'invalid signature' }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'invalid json' }, 400);
    }

    const inbound = parseInboundMessage(payload);
    if (!inbound) {
      // Not a message event we handle; acknowledge so Quo stops retrying.
      return c.json({ status: 'ignored' }, 200);
    }

    // Hand off to async processing and return 200 immediately. handleMessage
    // routes inbound → agent and outbound → staff-handoff detection.
    setImmediate(() => {
      pipeline
        .handleMessage(inbound)
        .catch((err) => logger.error({ err, id: inbound.providerMessageId }, 'pipeline failed'));
    });

    return c.json({ status: 'accepted' }, 200);
  });

  return app;
}
