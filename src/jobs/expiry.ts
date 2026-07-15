import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { PgStore } from '../db/pgStore.js';
import { runExpirySweep } from './expirySweep.js';

/**
 * Cron entrypoint (docker-compose `cron` service). Runs the expiry sweep on an
 * interval: expire holds past 6 PM Oakland and close conversations past TTL.
 *
 * A single-container interval loop is sufficient at this scale; move to a real
 * scheduler (or Postgres pg_cron) if the deployment grows.
 */
const INTERVAL_MS = 60_000; // sweep every minute

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new PgStore(config.DATABASE_URL);
  logger.info('expiry cron started');

  const tick = async () => {
    try {
      const result = await runExpirySweep(store, new Date());
      if (result.holdsExpired > 0 || result.conversationsClosed > 0) {
        logger.info(result, 'expiry sweep');
      }
    } catch (err) {
      logger.error({ err }, 'expiry sweep failed');
    }
  };

  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch((err) => {
  logger.error({ err }, 'expiry cron crashed');
  process.exit(1);
});
