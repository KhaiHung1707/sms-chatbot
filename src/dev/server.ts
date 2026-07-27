import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Config } from '../config.js';
import type { Store } from '../db/store.js';
import type { LlmClient } from '../llm/claude.js';
import type { QuoClient } from '../providers/quo.js';
import type { InventoryClient } from '../providers/inventory.js';
import { health } from '../routes/health.js';
import { createWebhookRoute } from '../routes/webhook.js';
import { Pipeline } from '../core/pipeline.js';
import { loadEnvLocal } from './loadEnvLocal.js';
import { MemoryStore } from './memoryStore.js';
import { RuleBasedLlm } from './ruleBasedLlm.js';
import { ConsoleQuo } from './consoleQuo.js';
import { FakeInventory } from './fakeInventory.js';

/**
 * Configurable local dev harness. Runs the whole bot on a laptop; which pieces
 * are REAL vs FAKE depends on what you put in .env.local:
 *
 *   Level 1 (default, no .env.local): rule LLM + in-memory DB + fake inventory,
 *           replies print to the terminal. No key, no DB, no internet.
 *   Level 2 (ANTHROPIC_API_KEY set):  real Claude Haiku for extraction — test
 *           multilingual / typo input. DB + inventory still fake.
 *   Level 3 (DATABASE_URL set too):   real Postgres (Supabase free) — test
 *           persistence, dedupe, holds transaction, cron. Migrations run on boot.
 *
 * Quo is always ConsoleQuo (prints instead of sending SMS) and inventory is
 * always FakeInventory — real SMS/inventory need a deployed environment.
 *
 * Send:  ./scripts/send.sh "+15105551234" "95 Accord front bumper"
 */

loadEnvLocal();

// A fixed dev webhook secret — scripts/send.sh uses the same value to sign.
export const DEV_WEBHOOK_SECRET = Buffer.from('dev-local-secret').toString('base64');
const PORT = Number(process.env.PORT ?? 3000);

// Webhook secret selection:
//   - Default: the fixed dev secret that scripts/send.sh signs with, so you can
//     test the whole bot from the terminal WITHOUT a phone or a tunnel.
//   - Set USE_REAL_QUO_WEBHOOK=1 to instead verify with the REAL QUO_WEBHOOK_SECRET
//     (needed only when a live Quo webhook hits you via a tunnel). In that mode
//     scripts/send.sh will 401 — that's expected; you're testing real inbound SMS.
const wantRealQuoWebhook =
  process.env.USE_REAL_QUO_WEBHOOK === '1' && Boolean(process.env.QUO_WEBHOOK_SECRET);
const WEBHOOK_SECRET = wantRealQuoWebhook ? process.env.QUO_WEBHOOK_SECRET! : DEV_WEBHOOK_SECRET;
const usingRealQuoSecret = wantRealQuoWebhook;

const config = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'dev',
  LLM_MODEL: process.env.LLM_MODEL ?? 'claude-haiku-4-5',
  QUO_API_KEY: 'dev',
  QUO_WEBHOOK_SECRET: WEBHOOK_SECRET,
  QUO_PHONE_NUMBER: '+15104512800',
  INVENTORY_API_URL: 'http://localhost/dev',
  INVENTORY_API_KEY: 'dev',
  DATABASE_URL: process.env.DATABASE_URL ?? 'memory://dev',
  SHOP_TIMEZONE: 'America/Los_Angeles',
  SHOP_ADDRESS: '1911 Union St, Oakland',
  CONVERSATION_TTL_HOURS: 2,
  HOLD_EXPIRY_HOUR: 18,
  PORT,
  LOG_LEVEL: 'info',
  NODE_ENV: 'development',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME ?? 'brandon',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, // set to enable /admin locally
} satisfies Config;

// --- Choose LLM: real Claude if a key is present, else the rule-based fake. ---
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
let llm: LlmClient;
let llmLabel: string;
if (hasKey) {
  const { AnthropicClient } = await import('../llm/claude.js');
  llm = new AnthropicClient(config.ANTHROPIC_API_KEY, config.LLM_MODEL);
  llmLabel = `REAL Claude (${config.LLM_MODEL})`;
} else {
  llm = new RuleBasedLlm();
  llmLabel = 'FAKE rule-based (no key)';
}

// --- Choose store: real Postgres if DATABASE_URL is present, else in-memory. ---
const hasDb = Boolean(process.env.DATABASE_URL);
let store: Store;
let storeLabel: string;
if (hasDb) {
  const { PgStore } = await import('../db/pgStore.js');
  const { runMigrations } = await import('../db/migrate.js');
  await runMigrations(process.env.DATABASE_URL!);
  store = new PgStore(process.env.DATABASE_URL!);
  storeLabel = 'REAL Postgres (migrations applied)';
} else {
  store = new MemoryStore();
  storeLabel = 'FAKE in-memory (resets on restart)';
}

// Quo stays fake in every dev level (prints instead of sending SMS).
const quo = new ConsoleQuo() as unknown as QuoClient;

// --- Choose inventory: real WooCommerce plugin if INVENTORY_API_URL is set,
//     else the 3-SKU fake. Real inventory lets you test against the live 74k
//     catalog through the same ./scripts/send.sh flow. ---
const hasInventory = Boolean(process.env.INVENTORY_API_URL && process.env.INVENTORY_API_KEY);
let inventory: InventoryClient;
let inventoryLabel: string;
if (hasInventory) {
  const { InventoryClient: RealInventory } = await import('../providers/inventory.js');
  inventory = new RealInventory({
    baseUrl: process.env.INVENTORY_API_URL!.replace(/\/$/, ''),
    apiKey: process.env.INVENTORY_API_KEY!,
  }) as unknown as InventoryClient;
  inventoryLabel = 'REAL WooCommerce plugin (live 74k catalog)';
} else {
  inventory = new FakeInventory() as unknown as InventoryClient;
  inventoryLabel = 'FAKE (3-SKU catalog)';
}

const pipeline = new Pipeline({ store, llm, quo, inventory, config });

const app = new Hono();

// Dev-only landing page. The bot is an API (only /health and POST /webhooks/quo
// exist), so opening the base URL in a browser would 404. This page shows the
// bot is up and how to test it — dev harness only, never in production.
app.get('/', (c) =>
  c.html(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OBP SMS Bot — Local Dev</title>
<style>
  body{font:15px/1.6 -apple-system,system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#1a1714;background:#fbf9f5}
  h1{font-size:22px;margin:0 0 4px} .ok{color:#3e8a5f;font-weight:600}
  code{background:#efeae1;padding:1px 6px;border-radius:5px;font-size:.9em}
  pre{background:#201b15;color:#f2eee7;padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:13px}
  table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}
  td,th{text-align:left;padding:6px 10px;border-bottom:1px solid #e4ded4}
  .muted{color:#8a837b;font-size:13px}
</style>
<h1>OBP SMS Bot <span class="ok">● running (dev)</span></h1>
<p class="muted">This is an API server — there's no web UI. Test it from a terminal.</p>
<h3>Send a test message</h3>
<pre>PORT=${PORT} ./scripts/send.sh "+15105551234" "95 Accord front bumper yes"</pre>
<p>Replies print in the terminal running <code>npm run dev:local</code>.</p>
<h3>Fake catalog (searchable)</h3>
<table>
<tr><th>Vehicle</th><th>Part</th><th>Price</th><th>Qty</th></tr>
<tr><td>1995 Honda Accord</td><td>front bumper</td><td>$129.95</td><td>4 (in stock)</td></tr>
<tr><td>1998 Honda Civic</td><td>left mirror</td><td>$42.50</td><td>1 (low)</td></tr>
<tr><td>2005 Toyota Camry</td><td>tail light</td><td>$88.00</td><td>0 (out)</td></tr>
</table>
<p class="muted">Endpoints: <code>GET /health</code> · <code>POST /webhooks/quo</code>.
Full guide: <code>docs/local-testing.md</code>.</p>
`),
);

app.route('/', health);
app.route('/', createWebhookRoute(config, pipeline));
// Admin page — only mounts if ADMIN_PASSWORD is set (else routes 404).
{
  const { createAdminRoute } = await import('../routes/admin.js');
  app.route('/', createAdminRoute(config, { store, llm, inventory, pipeline }));
}

const level = hasDb ? 3 : hasKey ? 2 : 1;

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  // eslint-disable-next-line no-console
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  OBP SMS Bot — LOCAL DEV                                      ║
╚══════════════════════════════════════════════════════════════╝

  Mode:      LEVEL ${level}
  LLM:       ${llmLabel}
  Store:     ${storeLabel}
  SMS:       ConsoleQuo (prints, never sends)
  Inventory: ${inventoryLabel}
  Webhook:   ${usingRealQuoSecret ? 'REAL Quo secret (live webhooks via tunnel; send.sh will 401)' : 'dev secret — test with ./scripts/send.sh (no phone needed)'}

  Listening: http://localhost:${PORT}   ·   health: /health

  Fake catalog (searchable):
${FakeInventory.describe()}

  Send a test message from another terminal:
    ./scripts/send.sh "+15105551234" "front bumper"
    ./scripts/send.sh "+15105551234" "95 Accord front bumper yes"
    ./scripts/send.sh "+15105551234" "STOP"
${level === 1 ? "\n  Add ANTHROPIC_API_KEY / DATABASE_URL to .env.local for Level 2 / 3.\n" : ''}
  Bot replies print here as:  📤 BOT → <phone>: "<reply>"
`);
});

// Friendly message when the port is taken (common — another app on :3000)
// instead of a raw EADDRINUSE stack trace.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    // eslint-disable-next-line no-console
    console.error(
      `\n  ✖ Port ${PORT} is already in use by another program.\n` +
        `    Start on a different port:  PORT=3999 npm run dev:local\n` +
        `    (then use that port in scripts/send.sh, e.g. localhost:3999)\n`,
    );
    process.exit(1);
  }
  throw err;
});
