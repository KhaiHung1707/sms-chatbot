-- Update 003: SKU / part-number lookup.
-- The bot can now look up a product directly by SKU (customer texts "GM1000683").
-- A SKU lookup records a part_lookups row with year/make/model/part_type NULL but
-- sku SET, so a hold confirmed in a later turn can recover the product by SKU.
-- Nullable, no default → existing rows keep sku = NULL (vehicle searches).
alter table part_lookups
  add column if not exists sku varchar(64);
