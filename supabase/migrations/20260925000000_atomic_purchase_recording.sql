-- Replaces the separate claim-insert / profile-update / grant_additional_pages
-- calls in /api/verify-purchase and /api/check-new-purchase with one atomic
-- statement. Those three used to run as independent requests: if the grant
-- step failed after the claim was already inserted, the receipt was
-- permanently marked "used" with no pages ever granted, and a retry just
-- hit the "already claimed" shortcut instead of trying again. Wrapping all
-- three writes in one function makes them succeed or fail together.
create function public.record_verified_purchase(
  p_user_id uuid,
  p_receipt_id text,
  p_approve boolean,
  p_grant_amount integer,
  p_shop_name text default null,
  p_buyer_user_id bigint default null
)
returns table (page_allowance integer)
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

-- Same reasoning as grant_additional_pages: Supabase grants execute on new
-- public-schema functions to anon/authenticated by default, so both have to
-- be revoked explicitly in addition to "public" -- and service_role needs
-- its own direct grant since it inherits nothing once "public" is revoked.
revoke execute on function public.record_verified_purchase(uuid, text, boolean, integer, text, bigint) from public, anon, authenticated;
grant execute on function public.record_verified_purchase(uuid, text, boolean, integer, text, bigint) to service_role;
