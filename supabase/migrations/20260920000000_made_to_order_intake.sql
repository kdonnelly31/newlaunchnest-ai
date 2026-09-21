-- Singleton settings row: the on/off switch and cutover timestamp for
-- made-to-order intake. Same pattern as etsy_seller_connection -- a data
-- change, not a deploy, turns this on.
create table public.mto_settings (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  cutover_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.mto_settings (id) values (1);
alter table public.mto_settings enable row level security;
-- No policies: service-role only, same as etsy_seller_connection.

-- One row per purchased line item (an Etsy transaction), not per receipt --
-- a receipt can bundle several purchases.
create table public.mto_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id bigint not null,
  receipt_id bigint not null,
  transaction_id bigint not null,
  listing_id bigint not null,
  quantity integer not null,
  buyer_etsy_user_id bigint,
  buyer_display_name text,
  receipt_created_at timestamptz not null,
  payment_state text not null check (payment_state in ('paid', 'canceled', 'refunded', 'pending')),
  fulfillment_status text not null default 'imported',
  needs_attention boolean not null default false,
  attention_reason text check (
    attention_reason is null or attention_reason in (
      'missing_information', 'unmapped_personalization', 'asset_unavailable',
      'product_unclear', 'multiple_units'
    )
  ),
  resolved_listing_id bigint,
  resolved_listing_snapshot jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, transaction_id)
);
create index mto_orders_needs_attention_idx on public.mto_orders (needs_attention) where needs_attention;
alter table public.mto_orders enable row level security;

create table public.mto_personalization_answers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.mto_orders (id) on delete cascade,
  question_id text,
  formatted_name text,
  formatted_value text not null,
  mapped_field text not null default 'unmapped' check (
    mapped_field in ('product_url', 'target_customer', 'messaging', 'traffic_source', 'assets', 'unmapped')
  ),
  mapping_version integer not null,
  created_at timestamptz not null default now()
);
alter table public.mto_personalization_answers enable row level security;

create table public.mto_assets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.mto_orders (id) on delete cascade,
  source_url text not null,
  storage_key text,
  content_type text,
  byte_size integer,
  status text not null default 'pending' check (status in ('pending', 'downloaded', 'failed')),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mto_assets enable row level security;

-- Singleton sync cursor + advisory lock (prevents the manual "Sync now"
-- button and the scheduled cron run from ever overlapping).
create table public.mto_sync_state (
  id integer primary key default 1 check (id = 1),
  cursor_min_created timestamptz,
  running_since timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.mto_sync_state (id) values (1);
alter table public.mto_sync_state enable row level security;

create table public.mto_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null check (trigger in ('manual', 'cron')),
  receipts_seen integer not null default 0,
  orders_created integer not null default 0,
  orders_updated integer not null default 0,
  error text
);
alter table public.mto_sync_runs enable row level security;

-- Private bucket for buyer-uploaded assets (photos/brand files). Never
-- public; the admin UI gets short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('mto-assets', 'mto-assets', false)
on conflict (id) do nothing;
