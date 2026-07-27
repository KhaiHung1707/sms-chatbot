import { z } from 'zod';

/**
 * Central, validated configuration. Fail fast at startup if anything required
 * is missing rather than discovering it mid-request.
 */
const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  // Model is configurable so it can be swapped (e.g. to Sonnet for accuracy, or
  // a future tier) without a code change. Default: Haiku 4.5 — cheapest tier,
  // well-suited to short SMS replies. See docs/inventory-api-spec.md / README.
  LLM_MODEL: z.string().default('claude-haiku-4-5'),

  QUO_API_KEY: z.string().min(1),
  QUO_WEBHOOK_SECRET: z.string().min(1),
  QUO_PHONE_NUMBER: z.string().min(1),

  INVENTORY_API_URL: z.string().url(),
  INVENTORY_API_KEY: z.string().min(1),

  DATABASE_URL: z.string().min(1),

  SHOP_TIMEZONE: z.string().default('America/Los_Angeles'),
  SHOP_ADDRESS: z.string().default('1911 Union St, Oakland, CA 94607'),
  CONVERSATION_TTL_HOURS: z.coerce.number().int().positive().default(2),
  HOLD_EXPIRY_HOUR: z.coerce.number().int().min(0).max(23).default(18),

  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Shared password for the /admin instructions page. Optional so the local dev
  // harness and tests boot without it (admin is then disabled); REQUIRED in
  // production is enforced below.
  ADMIN_PASSWORD: z.string().min(12).optional(),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  // The admin page must be password-protected in production.
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.ADMIN_PASSWORD) {
    throw new Error(
      'ADMIN_PASSWORD is required in production (min 12 chars) to protect the /admin page.',
    );
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: reset the memoized config. */
export function resetConfigCache(): void {
  cached = null;
}
