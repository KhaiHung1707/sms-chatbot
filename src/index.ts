import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { health } from './routes/health.js';
import { createWebhookRoute } from './routes/webhook.js';
import { createAdminRoute } from './routes/admin.js';
import { PgStore } from './db/pgStore.js';
import { runMigrations } from './db/migrate.js';
import { AnthropicClient } from './llm/claude.js';
import { QuoClient } from './providers/quo.js';
import { InventoryClient } from './providers/inventory.js';
import { Pipeline } from './core/pipeline.js';

const config = loadConfig();

// Apply pending migrations on startup (idempotent).
await runMigrations(config.DATABASE_URL);

// Wire concrete dependencies.
const store = new PgStore(config.DATABASE_URL);
const llm = new AnthropicClient(config.ANTHROPIC_API_KEY, config.LLM_MODEL);
const quo = new QuoClient({
  apiKey: config.QUO_API_KEY,
  webhookSecret: config.QUO_WEBHOOK_SECRET,
  phoneNumber: config.QUO_PHONE_NUMBER,
});
const inventory = new InventoryClient({
  baseUrl: config.INVENTORY_API_URL,
  apiKey: config.INVENTORY_API_KEY,
});
const pipeline = new Pipeline({ store, llm, quo, inventory, config });

const app = new Hono();
app.route('/', health);
app.route('/', createWebhookRoute(config, pipeline));
app.route('/', createAdminRoute(config, { store, llm, inventory, pipeline }));

// Bind 0.0.0.0 (not the default localhost) so the container platform's proxy /
// health check (Koyeb, Fly, Render, etc.) can reach the server from outside.
serve({ fetch: app.fetch, port: config.PORT, hostname: '0.0.0.0' }, (info) => {
  logger.info({ port: info.port }, 'obp-sms-bot listening');
});
