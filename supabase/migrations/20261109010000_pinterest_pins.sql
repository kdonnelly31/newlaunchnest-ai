-- Pin batch allowance: separate from page_allowance (design doc §16 item 9)
-- -- pin generation costs ~3x a landing page, and the Pin Creator is a
-- separate purchasable product, so it needs its own quota. Starts at 0:
-- unlike page_allowance (defaults to 3), the Pin Creator is purchased
-- separately -- landing pages aren't free without a purchase either.
alter table public.profiles
  add column pin_batch_allowance integer not null default 0;

-- One row per generated pin (3 rows per "Generate 3 Pins" click, sharing
-- one batch_id). Unlike landing_pages' minimal row, this row IS the
-- content -- there's no separate frozen-content document to render later.
create table public.pinterest_pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  listing_id bigint not null,
  brand_kit_id uuid references public.brand_kits (id) on delete set null,
  batch_id uuid not null,
  angle text not null check (angle in ('spotlight', 'buyer_focused', 'gift_lifestyle')),
  headline text not null,
  supporting_text text not null,
  pin_title text not null,
  pin_description text not null,
  keywords text[] not null default '{}',
  board_category text not null,
  destination_url text not null,
  image_path text not null,
  photo_classification text check (photo_classification in ('product', 'lifestyle', 'instructional', 'other')),
  classification_confidence text check (classification_confidence in ('high', 'medium', 'low')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.pinterest_pins enable row level security;

create policy "Users can view their own pinterest pins"
  on public.pinterest_pins for select
  using (auth.uid() = user_id);

-- Counts DISTINCT batches, not rows -- 3 rows (one per angle) share one
-- batch_id and must consume exactly 1 unit of pin_batch_allowance. All 3
-- rows inserted in one statement see the same pre-statement snapshot, so
-- this evaluates identically for each -- the real guard is simply "this
-- user's existing batch count is still under their allowance".
create policy "Users can insert pinterest pins within their allowance"
  on public.pinterest_pins for insert
  with check (
    auth.uid() = user_id
    and (
      select count(distinct batch_id) from public.pinterest_pins where user_id = auth.uid()
    ) < (
      select pin_batch_allowance from public.profiles where id = auth.uid()
    )
  );

create policy "Users can update their own pinterest pins"
  on public.pinterest_pins for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Friendly pre-check, same purpose and shape as create_landing_page_allowed
-- (20260910000000_page_allowance.sql): lets the server show a clear message
-- before doing any Claude/image-rendering work, instead of only discovering
-- the limit when the final insert is rejected by RLS.
create function public.create_pinterest_pins_allowed(p_user_id uuid)
returns table (allowed boolean, remaining integer)
language plpgsql
security invoker
as $$
declare
  v_allowance integer;
  v_used integer;
begin
  if p_user_id <> auth.uid() then
    raise exception 'Can only check your own allowance.';
  end if;

  select pin_batch_allowance into v_allowance from public.profiles where id = p_user_id;
  select count(distinct batch_id) into v_used from public.pinterest_pins where user_id = p_user_id;

  return query select (v_used < v_allowance), greatest(v_allowance - v_used, 0);
end;
$$;

grant execute on function public.create_pinterest_pins_allowed(uuid) to authenticated;

-- Called only from the server (service-role key) when a Pin Creator
-- purchase comes in -- never exposed to regular users. Mirrors
-- grant_additional_pages exactly (20260910000000_page_allowance.sql).
create function public.grant_additional_pin_batches(p_email text, p_amount integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_allowance integer;
begin
  update public.profiles
    set pin_batch_allowance = pin_batch_allowance + p_amount
    where email = p_email
    returning pin_batch_allowance into v_new_allowance;

  if v_new_allowance is null then
    raise exception 'No profile found for email %', p_email;
  end if;

  return v_new_allowance;
end;
$$;

revoke execute on function public.grant_additional_pin_batches(text, integer) from public, anon, authenticated;
grant execute on function public.grant_additional_pin_batches(text, integer) to service_role;
