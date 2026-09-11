-- Admins (the site owner/staff) shouldn't be capped by the page allowance --
-- that limit exists to gate paying customers, not the people running the app.
-- Replaces both enforcement points from the original migration so admins pass
-- unconditionally; remaining is returned as NULL for admins to mean "unlimited".

create or replace function public.create_landing_page_allowed(p_user_id uuid)
returns table (allowed boolean, remaining integer)
language plpgsql
security invoker
as $$
declare
  v_allowance integer;
  v_used integer;
  v_role text;
begin
  if p_user_id <> auth.uid() then
    raise exception 'Can only check your own allowance.';
  end if;

  select role, page_allowance into v_role, v_allowance from public.profiles where id = p_user_id;

  if v_role = 'admin' then
    return query select true, null::integer;
    return;
  end if;

  select count(*) into v_used from public.landing_pages where user_id = p_user_id;

  return query select (v_used < v_allowance), greatest(v_allowance - v_used, 0);
end;
$$;

drop policy "Users can insert landing pages within their allowance" on public.landing_pages;

create policy "Users can insert landing pages within their allowance"
  on public.landing_pages for insert
  with check (
    auth.uid() = user_id
    and (
      exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
      or (
        select count(*) from public.landing_pages where user_id = auth.uid()
      ) < (
        select page_allowance from public.profiles where id = auth.uid()
      )
    )
  );
