-- Tracks every Etsy receipt ever used to verify a purchase (first-time
-- approval or a later repurchase for more pages), so a receipt can't be
-- reused across accounts even after profiles.etsy_receipt_id gets
-- overwritten by a subsequent purchase.
create table public.claimed_etsy_receipts (
    receipt_id text primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
  claimed_at timestamptz not null default now()
);

alter table public.claimed_etsy_receipts enable row level security;
-- No policies: only /api/verify-purchase (via supabaseAdmin) reads/writes this,
-- same pattern as etsy_seller_connection.
