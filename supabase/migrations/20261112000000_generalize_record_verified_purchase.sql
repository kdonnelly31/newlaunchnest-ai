-- Pinterest Pins are now a true standalone purchase (no prior landing-page
-- purchase required) -- record_verified_purchase previously only ever
-- touched page_allowance, so a verified pin purchase had nowhere real to
-- grant to. Adds p_product so the same atomic claim+approve+grant call
-- works for either product, incrementing only the allowance that was
-- actually paid for. CREATE OR REPLACE can't add a new parameter in the
-- middle of an existing signature cleanly here either (same constraint as
-- 20260925010000), so the old signature is dropped first.
drop function if exists public.record_verified_purchase(uuid, text, boolean, integer, text, bigint);

create function public.record_verified_purchase(
  p_user_id uuid,
  p_receipt_id text,
  p_approve boolean,
  p_grant_amount integer,
  p_product text default 'landing_page',
  p_shop_name text default null,
  p_buyer_user_id bigint default null
)
returns table (new_page_allowance integer, new_pin_batch_allowance integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_product not in ('landing_page', 'pinterest_pins') then
    raise exception 'Unknown product: %', p_product;
  end if;

  insert into public.claimed_etsy_receipts (receipt_id, user_id)
  values (p_receipt_id, p_user_id);

  -- One account, one approval status and one shop name shared across both
  -- products -- whichever product is purchased first approves the account;
  -- the other product's later purchase just tops up its own allowance.
  return query
  update public.profiles
    set
      etsy_receipt_id = p_receipt_id,
      purchase_verified_at = now(),
      status = case when p_approve then 'approved' else status end,
      etsy_shop_name = coalesce(p_shop_name, etsy_shop_name),
      etsy_buyer_user_id = coalesce(p_buyer_user_id, etsy_buyer_user_id),
      page_allowance = page_allowance + case when p_product = 'landing_page' then p_grant_amount else 0 end,
      pin_batch_allowance = pin_batch_allowance + case when p_product = 'pinterest_pins' then p_grant_amount else 0 end
    where id = p_user_id
    returning page_allowance, pin_batch_allowance;
end;
$$;

revoke execute on function public.record_verified_purchase(uuid, text, boolean, integer, text, text, bigint) from public, anon, authenticated;
grant execute on function public.record_verified_purchase(uuid, text, boolean, integer, text, text, bigint) to service_role;
