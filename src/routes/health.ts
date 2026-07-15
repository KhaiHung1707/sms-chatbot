import { Hono } from 'hono';

/** Liveness probe. Returns 200 with minimal payload. */
export const health = new Hono();

health.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }));
