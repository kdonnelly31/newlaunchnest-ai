-- Manually-set mapping of a customer to their Etsy shop, since Etsy's API has
-- no way to look up a shop by email. Set by an admin in admin.html; customers
-- cannot edit it themselves (not included in the update grant below).
alter table public.profiles
  add column etsy_shop_name text;
