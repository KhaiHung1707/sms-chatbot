-- OBP SMS Assistant — initial schema
-- Run as the first migration on Supabase Postgres.
-- Design principle: wc_product_id is only a pointer to WooCommerce (different
-- server, no joins). Price/stock are always fetched fresh at reply time.

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,            -- E.164, e.g. +15105551234
  language text default 'en',            -- ISO 639-1, detected once then reused
  opted_out boolean default false,
  created_at timestamptz default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  status text not null default 'open',   -- open | closed | handed_off
  channel text not null default 'sms',   -- future-proof: whatsapp/webchat
  expires_at timestamptz not null,       -- now() + interval '2 hours', extended on every new message
  created_at timestamptz default now()
);
create index if not exists idx_conversations_customer on conversations(customer_id);
create index if not exists idx_conversations_expires on conversations(expires_at)
  where status = 'open';

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  direction text not null,               -- in | out
  body text not null,
  provider_message_id text,              -- id from Quo, used for webhook DEDUPE
  created_at timestamptz default now()
);
-- Dedupe guard (R-10): a repeated webhook with the same Quo message id
-- cannot be inserted twice.
create unique index if not exists idx_messages_provider_id on messages(provider_message_id)
  where provider_message_id is not null;
create index if not exists idx_messages_conversation on messages(conversation_id, created_at);

create table if not exists part_lookups (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  year int,
  make text,
  model text,
  part_type text,
  wc_product_id bigint,                  -- pointer to Woo, NOT a real FK
  price_snapshot numeric(10,2),          -- price at reply time (audit trail)
  warehouse text,
  result text not null,                  -- found | no_stock | not_found | api_error
  created_at timestamptz default now()
);
create index if not exists idx_part_lookups_conversation on part_lookups(conversation_id);

create table if not exists holds (
  id uuid primary key default gen_random_uuid(),
  lookup_id uuid not null references part_lookups(id),
  qty int not null default 1,
  status text not null default 'active', -- active | expired | fulfilled | cancelled
  expires_at timestamptz not null,       -- default 6 PM same day, Oakland time (America/Los_Angeles)
  created_at timestamptz default now()
);
create index if not exists idx_holds_active_expiry on holds(expires_at)
  where status = 'active';
