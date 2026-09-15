-- Extends the existing landing_pages table (rather than adding a new one)
-- to hold a frozen content snapshot so /p/:id can serve a permanent public
-- page without re-fetching Etsy or the seller's data on every view.
alter table public.landing_pages
  add column listing_id bigint,
  add column content jsonb;
