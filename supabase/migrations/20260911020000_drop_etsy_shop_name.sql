-- Reverting the manual shop-name-prefill feature -- going back to buyers
-- typing their own shop name in the search box.
alter table public.profiles
  drop column if exists etsy_shop_name;
