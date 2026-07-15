-- Update 001 Rule 2 — harden effective-availability queries.
-- Idempotent; safe to re-run.

-- (1) Index the holds→part_lookups join key so getActiveHoldQty and the atomic
--     hold check don't full-scan part_lookups as it grows. This is queried on
--     every search_inventory call.
create index if not exists idx_part_lookups_wc_product
  on part_lookups(wc_product_id)
  where wc_product_id is not null;

-- (2) Audit trail: record the effective quantity quoted to the customer at
--     reply time (not just the price). Nullable — earlier rows won't have it.
alter table part_lookups
  add column if not exists effective_qty int;
