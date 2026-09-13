-- Holds the single OAuth connection to the seller's (your) own Etsy shop.
-- Never exposed to any client; only the service-role key reads/writes it.
create table public.etsy_seller_connection (
  id integer primary key default 1 check (id = 1), -- singleton row
  shop_id bigint not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.etsy_seller_connection enable row level security;
-- No policies: RLS blocks anon/authenticated entirely; service_role bypasses RLS.

-- Tracks which verified Etsy order unlocked each account, and prevents
-- one order number from being used to approve more than one account.
alter table public.profiles
  add column etsy_receipt_id text,
  add column purchase_verified_at timestamptz;

create unique index profiles_etsy_receipt_id_key
  on public.profiles (etsy_receipt_id)
  where etsy_receipt_id is not null;
