-- type in) from their most recently verified receipt. Lets a repurchase be
-- auto-detected by matching Etsy's own receipt data against this ID instead
-- Stores the buyer's Etsy account ID (assigned by Etsy, not something they
-- of asking the customer to retype a new order number every time.
alter table public.profiles
  add column etsy_buyer_user_id bigint;
