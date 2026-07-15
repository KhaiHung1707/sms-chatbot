import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  verifyQuoSignature,
  parseInboundMessage,
  QuoClient,
  OutOfCreditError,
} from '../src/providers/quo.js';
import {
  signQuoBody,
  inboundWebhookBody,
  TEST_WEBHOOK_SECRET,
} from './mocks.js';

describe('verifyQuoSignature (R-07)', () => {
  it('accepts a correctly-signed body', () => {
    const body = inboundWebhookBody();
    const header = signQuoBody(body, TEST_WEBHOOK_SECRET);
    expect(verifyQuoSignature(body, header, TEST_WEBHOOK_SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = inboundWebhookBody();
    const header = signQuoBody(body, TEST_WEBHOOK_SECRET);
    const tampered = body.replace('Hi', 'Hacked');
    expect(verifyQuoSignature(tampered, header, TEST_WEBHOOK_SECRET)).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    const body = inboundWebhookBody();
    expect(verifyQuoSignature(body, undefined, TEST_WEBHOOK_SECRET)).toBe(false);
    expect(verifyQuoSignature(body, 'garbage', TEST_WEBHOOK_SECRET)).toBe(false);
    expect(verifyQuoSignature(body, 'hmac;1', TEST_WEBHOOK_SECRET)).toBe(false);
  });
});

describe('parseInboundMessage', () => {
  it('normalizes an inbound message', () => {
    const msg = parseInboundMessage(JSON.parse(inboundWebhookBody({ body: 'Accord bumper' })));
    expect(msg).not.toBeNull();
    expect(msg?.direction).toBe('incoming');
    expect(msg?.from).toBe('+15105551234');
    expect(msg?.body).toBe('Accord bumper');
    expect(msg?.hasMedia).toBe(false);
  });

  it('flags media messages', () => {
    const msg = parseInboundMessage(
      JSON.parse(inboundWebhookBody({ media: [{ url: 'https://x/y.jpg', type: 'image/jpeg' }] })),
    );
    expect(msg?.hasMedia).toBe(true);
  });

  it('tolerates a `to` array defensively', () => {
    const raw = JSON.parse(inboundWebhookBody());
    raw.data.object.to = ['+15104512800'];
    const msg = parseInboundMessage(raw);
    expect(msg?.to).toBe('+15104512800');
  });

  it('returns null for an unrelated payload', () => {
    expect(parseInboundMessage({ foo: 'bar' })).toBeNull();
  });
});

describe('QuoClient.sendMessage — retry/backoff (R-09)', () => {
  afterEach(() => vi.restoreAllMocks());

  const client = () =>
    new QuoClient({
      apiKey: 'k',
      webhookSecret: 'k',
      phoneNumber: '+15104512800',
      maxSendAttempts: 3,
      sleep: async () => {}, // no real delay in tests
    });

  const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;

  it('retries a 429 then succeeds', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(res(200, { data: { id: 'AC9' } }));
    const out = await client().sendMessage('+15105551234', 'hi');
    expect(out.id).toBe('AC9');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries 5xx then succeeds', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200, { data: { id: 'AC10' } }));
    const out = await client().sendMessage('+15105551234', 'hi');
    expect(out.id).toBe('AC10');
  });

  it('gives up after maxAttempts on persistent 429', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(429));
    await expect(client().sendMessage('+15105551234', 'hi')).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a 400 (permanent client error)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(400));
    await expect(client().sendMessage('+15105551234', 'hi')).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws OutOfCreditError on 402 without retrying', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(402));
    await expect(client().sendMessage('+15105551234', 'hi')).rejects.toBeInstanceOf(OutOfCreditError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
