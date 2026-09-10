-- Page allowance: how many landing pages a user is entitled to create in total,
-- cumulative across purchases (grant_additional_pages adds to it, never resets it).
alter table public.profiles
  add column page_allowance integer not null default 3;

-- One row per landing page a user has created. Deliberately minimal (just enough
-- to count against the allowance) -- no listing/content data is stored here.
create table public.landing_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.landing_pages enable row level security;

create policy "Users can view their own landing pages"
  on public.landing_pages for select
  using (auth.uid() = user_id);

-- The real enforcement point: even a direct insert (bypassing the app and the
-- create_landing_page_allowed() check below) is rejected once the user's
-- existing row count reaches their page_allowance.
create policy "Users can insert landing pages within their allowance"
  on public.landing_pages for insert
  with check (
    auth.uid() = user_id
    and (
      select count(*) from public.landing_pages where user_id = auth.uid()
    ) < (
      select page_allowance from public.profiles where id = auth.uid()
    )
  );

-- Friendly pre-check the app calls before doing any work, so it can show a
-- clear message instead of just letting the insert fail. Security-invoker: it
-- only ever reads the caller's own rows, via the same RLS policies above.
create function public.create_landing_page_allowed(p_user_id uuid)
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

  select page_allowance into v_allowance from public.profiles where id = p_user_id;
  select count(*) into v_used from public.landing_pages where user_id = p_user_id;

  return query select (v_used < v_allowance), greatest(v_allowance - v_used, 0);
end;
$$;

grant execute on function public.create_landing_page_allowed(uuid) to authenticated;

-- Called only from the server (service-role key) when a repurchase comes in --
-- never exposed to regular users. security definer so it can update a profile
-- row other than the caller's; the execute grant below is what actually
-- restricts that, since there's no auth.uid() to check under the service role.
create function public.grant_additional_pages(p_email text, p_amount integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_allowance integer;
begin
  update public.profiles
    set page_allowance = page_allowance + p_amount
    where email = p_email
    returning page_allowance into v_new_allowance;

  if v_new_allowance is null then
    raise exception 'No profile found for email %', p_email;
  end if;

  return v_new_allowance;
end;
$$;

-- Supabase grants execute on new public-schema functions to anon/authenticated
-- by default (a schema-level default privilege) -- revoking from just "public"
-- doesn't undo that, so both roles have to be revoked explicitly.
revoke execute on function public.grant_additional_pages(text, integer) from public, anon, authenticated;
grant execute on function public.grant_additional_pages(text, integer) to service_role;
