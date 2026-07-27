-- Update 004: client-editable bot instructions with draft/live/rollback.
-- The shop owner edits the bot's conversation-flow "steps" from an admin page.
-- One table holds every version; exactly one row is 'live' (what the bot uses)
-- and at most one is 'draft' (what the owner is editing).
create table if not exists instruction_versions (
  id           uuid primary key default gen_random_uuid(),
  version      integer not null,
  steps        jsonb not null,                          -- ordered array of strings
  status       text not null check (status in ('draft','live','archived')),
  note         text,                                    -- owner's per-version note
  author       text,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);

-- At most ONE live and at most ONE draft (low-concurrency guarantee).
create unique index if not exists idx_instr_one_live
  on instruction_versions(status) where status = 'live';
create unique index if not exists idx_instr_one_draft
  on instruction_versions(status) where status = 'draft';
create index if not exists idx_instr_version on instruction_versions(version desc);

-- NOTE: v1 (status='live') is SEEDED FROM CODE, not here — see the seed step in
-- src/db/migrate.ts, which inserts DEFAULT_INSTRUCTION_STEPS verbatim only when
-- the table is empty. Seeding from code guarantees the DB's live steps are
-- byte-identical to the code default, so the pipeline reads back exactly today's
-- behavior. (Hardcoding the JSON here would risk drift from the TS constant.)
