-- Re-adds etsy_shop_name (dropped in the previous migration), this time as the
-- basis for real access control: customers can only ever browse the one shop
-- an admin assigns them, enforced server-side in server.js, not just in the UI.
alter table public.profiles
  add column etsy_shop_name text;
