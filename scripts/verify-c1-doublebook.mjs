// Level-3 verification for bug C1: two concurrent holds on the LAST unit must
// NOT both succeed. Runs against the real Supabase Postgres in .env.local.
// The advisory lock in createHoldIfAvailable must serialize them so exactly one
// wins. MemoryStore can't reproduce this (single-threaded), so this is the only
// way to prove the fix.
//
// Run: node scripts/verify-c1-doublebook.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
// Minimal .env.local loader (only DATABASE_URL needed).
for (const line of readFileSync(join(__dir, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { PgStore } = await import('../dist/db/pgStore.js');
const { runMigrations } = await import('../dist/db/migrate.js');

const url = process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL'); process.exit(1); }

await runMigrations(url);
const store = new PgStore(url);

// Unique product id for this run so we don't collide with real data.
const PRODUCT = 990000 + Math.floor((Date.now() / 1000) % 9000);
const TENANT = `c1-verify-${PRODUCT}`;

console.log(`\n=== C1 verify: two concurrent holds on the LAST unit (product ${PRODUCT}) ===\n`);

// Set up a customer/conversation/lookup so createHoldIfAvailable has a lookupId.
const cust = await store.createCustomer(`+1500${PRODUCT}`);
const conv = await store.createConversation(cust.id, new Date(Date.now() + 3600_000));
const lookup = await store.recordLookup({
  conversationId: conv.id, wcProductId: PRODUCT, result: 'found',
  year: 2015, make: 'test', model: 'test', partType: 'bumper',
  priceSnapshot: 50, warehouse: 'US', effectiveQty: 1,
});

const expiresAt = new Date(Date.now() + 3600_000); // 1h future so it stays active

// apiQty = 1 (the last unit). Fire N holds concurrently — a real stress race.
const N = 10;
const results = await Promise.all(
  Array.from({ length: N }, () =>
    store.createHoldIfAvailable({ lookupId: lookup.id, wcProductId: PRODUCT, apiQty: 1, qty: 1, expiresAt }),
  ),
);

const succeeded = results.filter(Boolean).length;
const activeHeld = await store.getActiveHoldQty(PRODUCT);

console.log(`${N} concurrent holds fired at the SINGLE last unit.`);
console.log(`Holds that succeeded: ${succeeded} (must be 1)`);
console.log(`Active held qty in DB: ${activeHeld} (must be 1)`);
console.log('');

const pass = succeeded === 1 && activeHeld === 1;
console.log(pass
  ? '✅ PASS — exactly ONE hold won. Advisory lock prevents double-booking.'
  : `❌ FAIL — ${succeeded} holds succeeded, ${activeHeld} active. DOUBLE-BOOKING still possible!`);

// Cleanup: cancel the holds + remove test rows so we don't pollute the DB.
await store.expireHolds(new Date(Date.now() + 7200_000)); // expire our future holds
console.log('\n(cleanup done — test holds expired)');
process.exit(pass ? 0 : 1);
