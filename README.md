# OBP SMS Assistant — Middleware

AI-powered SMS customer service bot for Oakland Body Parts. This repo is the
**middleware** only: it receives SMS webhooks from Quo, runs a Claude tool-calling
loop against a WooCommerce inventory API, and replies — in the customer's own
language, never inventing prices.

> The WordPress Inventory API plugin and the dashboard are **separate
> deliverables**. See [`docs/inventory-api-spec.md`](docs/inventory-api-spec.md).

## Status: Phase 1 + Phase 2 complete

The full pipeline works end-to-end against mocks: webhook → guards → STOP/HELP →
conversation (phone + TTL) → Claude tool loop (cap 3 rounds) → reply, plus the
cron expiry sweep, auto-handoff detection, and language persistence. 39 tests
pass offline, including the 6 required integration scenarios.

Remaining before go-live is **operational, not code** — see
[`MANUAL_TASKS.md`](MANUAL_TASKS.md) (API keys, A2P 10DLC, the PHP inventory
plugin, deploy, and the manual test with the client).

## Quick start

```bash
npm install
cp .env.example .env    # fill in keys
npm run typecheck
npm test                # runs fully offline against mocks
npm run dev
```

Apply the DB schema on Supabase:

```bash
psql "$DATABASE_URL" -f migrations/001_init.sql
```

## Layout

```
src/
  index.ts              # Hono app + routes
  config.ts             # zod-validated env, fail-fast
  logger.ts             # pino JSON logging
  types.ts              # shared domain types
  routes/
    webhook.ts          # POST /webhooks/quo — verify sig, 200 in <1s, async
    health.ts           # GET /health
  core/
    guards.ts           # fail-safe intake gate (opt-out, direction, media)
  llm/
    systemPrompt.ts     # agent prompt + confidence gate
    tools.ts            # search_inventory / create_hold defs + executors
  providers/
    quo.ts              # send SMS, verify HMAC webhook, parse payload
    inventory.ts        # WP API client — 8s timeout, retry once, mockable
  jobs/
    holdTime.ts         # DST-correct 6 PM Oakland hold expiry
migrations/001_init.sql
tests/                  # vitest; Quo + Inventory fully mocked
docs/inventory-api-spec.md
```

## Update 001 — real-time inventory (live warehouse)

Stock changes hourly, so:
- **No inventory caching** (`tests/nocache.test.ts` grep-guards it). Every number
  comes from a fresh API call at reply time.
- **Effective qty = api qty − active holds** — the model only ever sees
  hold-adjusted stock, so it can't quote a unit already reserved (`src/llm/tools.ts`).
- **Atomic holds** — `createHoldIfAvailable` checks availability and inserts in
  one transaction, so two conversations can't both reserve the last unit
  (`src/db/pgStore.ts`; race test in `tests/availability.test.ts`).
- **Honest phrasing** — the prompt qualifies low stock with "as of right now",
  proactively offers a hold, and forbids "guaranteed" in any language.

## Design decisions baked in (risk mitigations)

- **Confidence gate** — the bot ALWAYS confirms the parsed vehicle before quoting
  a price (`src/llm/systemPrompt.ts`). Free-text extraction from typos / multiple
  languages is unreliable; a wrong-fitment quote causes returns.
- **Never invent numbers** — `search_inventory` is the only price source; on API
  error the executor returns an explicit "state no numbers" instruction and no
  price (`src/llm/tools.ts`, guardrail-tested).
- **Fail-safe intake** — one ordered gate (`src/core/guards.ts`) drops outgoing
  messages, opted-out customers, and media-only messages before any expensive
  work, neutralizing several risks at once.
- **Quo integration, verified** — auth has NO `Bearer` prefix; `to` is an array
  on send but a string on inbound; the signature header is `openphone-signature`.
  See `src/providers/quo.ts`.
- **DST-correct holds** — hold expiry is computed via `Intl`, not a fixed offset
  (`src/jobs/holdTime.ts`), tested across PST/PDT.
- **Webhook dedupe** — unique index on `provider_message_id` (migration).
- **Fast webhook** — verify signature, return 200, process the LLM in
  `setImmediate` so Quo never waits.

## Phase 1 — next

Build the agentic pipeline (`src/core/pipeline.ts`): load/create conversation by
phone + TTL, run the Claude tool loop (cap 3 tool rounds), record `part_lookups`,
send the reply, handle STOP/HELP and staff handoff. Then the 6 required
integration tests and the Docker cron entrypoint (`src/jobs/expiry.ts`).
