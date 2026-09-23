-- record_verified_purchase (20260925000000) named its RETURNS TABLE column
-- "page_allowance", the same name as profiles.page_allowance -- inside the
-- function body, "returning page_allowance" was ambiguous between the two,
-- so every call failed with "column reference page_allowance is ambiguous".
-- This has been broken since it was deployed; renaming the output column
-- resolves the ambiguity. CREATE OR REPLACE can't rename a RETURNS TABLE
-- column, so the old signature has to be dropped first.
drop function if exists public.record_verified_purchase(uuid, text, boolean, integer, text, bigint);

create function public.record_verified_purchase(
  p_user_id uuid,
  p_receipt_id text,
  p_approve boolean,
  p_grant_amount integer,
  p_shop_name text default null,
  p_buyer_user_id bigint default null
)
returns table (new_page_allowance integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.claimed_etsy_receipts (receipt_id, user_id)
  values (p_receipt_id, p_user_id);

  return query
  update public.profiles
    set
      etsy_receipt_id = p_receipt_id,
      purchase_verified_at = now(),
      status = case when p_approve then 'approved' else status end,
      etsy_shop_name = coalesce(p_shop_name, etsy_shop_name),
      etsy_buyer_user_id = coalesce(p_buyer_user_id, etsy_buyer_user_id),
      page_allowance = page_allowance + p_grant_amount
    where id = p_user_id
    returning page_allowance;
end;
$$;

revoke execute on function public.record_verified_purchase(uuid, text, boolean, integer, text, bigint) from public, anon, authenticated;
grant execute on function public.record_verified_purchase(uuid, text, boolean, integer, text, bigint) to service_role;
