-- Brand Kits: a seller's saved colors/fonts/logo/style for Pinterest Pin
-- Creator graphics. One seller can have several; no cap in Phase 1.
create table public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  primary_color text not null,
  secondary_color text,
  accent_color text,
  headline_font text not null default 'inter' check (headline_font in ('inter', 'fraunces')),
  body_font text not null default 'inter' check (body_font in ('inter', 'fraunces')),
  logo_path text,
  visual_style text not null default 'minimal' check (visual_style in ('minimal', 'lifestyle', 'typography_forward', 'photo_first')),
  created_at timestamptz not null default now()
);

alter table public.brand_kits enable row level security;

create policy "Users can view their own brand kits"
  on public.brand_kits for select
  using (auth.uid() = user_id);

create policy "Users can insert their own brand kits"
  on public.brand_kits for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own brand kits"
  on public.brand_kits for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own brand kits"
  on public.brand_kits for delete
  using (auth.uid() = user_id);

-- Private bucket for rendered pin images and uploaded Brand Kit logos.
-- Never public; the server hands out short-lived signed URLs, same pattern
-- as mto-assets (see 20260920000000_made_to_order_intake.sql) -- no
-- storage.objects RLS policy exists or is needed, since nothing reads this
-- bucket directly from the browser with a user's own session.
insert into storage.buckets (id, name, public)
values ('pinterest-pin-assets', 'pinterest-pin-assets', false)
on conflict (id) do nothing;
