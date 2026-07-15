import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { InboundMessage } from '../types.js';

/**
 * Quo (formerly OpenPhone) integration.
 *
 * Three details verified against the official docs that differ from naive
 * assumptions — do not "fix" these back:
 *   1. Auth has NO `Bearer` prefix. The API key is the raw Authorization value.
 *   2. `to` is an ARRAY on send, but a single STRING on inbound payloads.
 *   3. The signature header is still literally `openphone-signature` post-rebrand.
 */

const QUO_API_BASE = 'https://api.openphone.com';
const SIGNATURE_HEADER = 'openphone-signature';

/** Zod schema for the inbound webhook envelope we care about. */
const webhookSchema = z.object({
  type: z.string(),
  data: z.object({
    object: z.object({
      id: z.string(),
      object: z.literal('message').optional(),
      from: z.string(),
      to: z.union([z.string(), z.array(z.string())]),
      direction: z.enum(['incoming', 'outgoing']),
      body: z.string().default(''),
      media: z
        .array(z.object({ url: z.string(), type: z.string() }))
        .optional()
        .default([]),
      userId: z.string().nullable().optional(),
    }),
  }),
});

export type QuoWebhookEnvelope = z.infer<typeof webhookSchema>;

export interface QuoConfig {
  apiKey: string;
  webhookSecret: string; // base64-encoded HMAC key
  phoneNumber: string; // shop's own E.164 number
  /** Max send attempts on transient errors (429/5xx). Default 3. */
  maxSendAttempts?: number;
  /** Injectable sleep for backoff — tests pass a no-op. Default real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Verify a Quo webhook signature (R-07).
 *
 * Header format: `hmac;<version>;<timestamp>;<base64digest>`
 * Signed data:   `<timestamp> + "." + <raw request body>`
 * The signing key is provided base64-encoded and must be decoded to binary
 * before computing the HMAC.
 *
 * `rawBody` MUST be the exact bytes received — parse JSON only after verifying.
 */
export function verifyQuoSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  base64Secret: string,
): boolean {
  if (!signatureHeader) return false;

  const fields = signatureHeader.split(';');
  if (fields.length < 4) return false;
  const [scheme, , timestamp, providedDigest] = fields;
  if (scheme !== 'hmac' || !timestamp || !providedDigest) return false;

  const key = Buffer.from(base64Secret, 'base64');
  const signedData = `${timestamp}.${rawBody}`;
  const computed = createHmac('sha256', key).update(signedData).digest('base64');

  const a = Buffer.from(computed);
  const b = Buffer.from(providedDigest);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Parse a verified webhook body into our normalized InboundMessage.
 * Only `message.received` events carry inbound customer messages, but we
 * normalize any message event so the pipeline can decide what to ignore.
 */
export function parseInboundMessage(body: unknown): InboundMessage | null {
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) return null;

  const obj = parsed.data.data.object;
  // `to` is a string on inbound but tolerate an array defensively.
  const to = Array.isArray(obj.to) ? (obj.to[0] ?? '') : obj.to;

  return {
    providerMessageId: obj.id,
    from: obj.from,
    to,
    body: obj.body,
    direction: obj.direction,
    hasMedia: (obj.media?.length ?? 0) > 0,
    userId: obj.userId ?? null,
  };
}

export class OutOfCreditError extends Error {
  constructor(message = 'Quo subscription expired or out of credit') {
    super(message);
    this.name = 'OutOfCreditError';
  }
}

/** Client for sending outbound SMS via Quo. */
export class QuoClient {
  constructor(private readonly config: QuoConfig) {}

  /**
   * Send an SMS. `content` must be 1–1600 chars with non-whitespace.
   * Auth header is the raw API key (NO Bearer prefix).
   *
   * Retries transient failures (R-09): 429 (rate limit — docs don't publish a
   * threshold, so handle defensively) and 5xx are retried with exponential
   * backoff, honoring a `retry-after` header if Quo sends one. Permanent errors
   * are NOT retried: 402 → OutOfCreditError (caller logs CRITICAL); other 4xx
   * (400/401/403) throw immediately.
   */
  async sendMessage(to: string, content: string): Promise<{ id: string }> {
    const maxAttempts = this.config.maxSendAttempts ?? 3;
    const sleep = this.config.sleep ?? defaultSleep;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(`${QUO_API_BASE}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.config.apiKey, // NO "Bearer" prefix
        },
        body: JSON.stringify({
          from: this.config.phoneNumber,
          to: [to], // ARRAY on send
          content,
        }),
      });

      if (res.ok) {
        const json = (await res.json()) as { data?: { id?: string } };
        return { id: json.data?.id ?? '' };
      }

      if (res.status === 402) {
        // Out of credit / subscription expired — permanent, don't retry.
        throw new OutOfCreditError();
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        const text = await res.text().catch(() => '');
        throw new Error(`Quo send failed (${res.status}): ${text}`);
      }

      // Transient: back off (respect retry-after if present) and retry.
      lastError = new Error(`Quo send transient error (${res.status})`);
      const retryAfter = Number(res.headers.get('retry-after'));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** (attempt - 1) * 250; // 250ms, 500ms, 1s, ...
      await sleep(delayMs);
    }

    // Unreachable (loop either returns or throws), but satisfies the type.
    throw lastError ?? new Error('Quo send failed');
  }
}

export { SIGNATURE_HEADER };
