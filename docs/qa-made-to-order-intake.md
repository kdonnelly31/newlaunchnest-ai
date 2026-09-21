# Manual QA: Made-to-Order Personalization Intake

Run this after any change touching Etsy sync, personalization mapping, or
the made-to-order admin screen. Requires: an admin account, the Etsy seller
connection already set up (`/admin.html` → Etsy status), and the converted
listing's real ID in `ETSY_PRODUCT_LISTING_ID`.

**Before you start:** leave `mto_settings.enabled = false` until the very
last section — every earlier check can be done safely with intake off.

## 1. Settings panel

- [ ] Open `/admin-mto.html`. Confirm "Enabled" is unchecked and "Cutover
      time" is empty (the default from the migration).
- [ ] Set a cutover time in the past few minutes, leave "Enabled" unchecked,
      click Save. Reload the page — confirm the value persisted.

## 2. Sync while disabled

- [ ] Click "Sync now". Confirm the result shown is `skipped: not_enabled`
      and no rows appear in `mto_orders` (check Supabase Table Editor).

## 3. Sync while enabled, against a real test purchase

- [ ] Check "Enabled", Save.
- [ ] Place one real, low-value test purchase of the converted listing,
      filling in whatever personalization questions currently exist on it.
- [ ] Click "Sync now" (don't wait for the 10-minute cron). Confirm the
      result shows `ordersCreated: 1`.
- [ ] In `/admin-mto.html`'s orders table, confirm the new order appears
      with the correct buyer name and "paid" state.
- [ ] Open the order's detail view — confirm every answer you typed appears
      under "raw answers," and any question already in `QUESTION_ID_MAP`
      (or matching a known label) shows the right mapped field.

## 4. Duplicate-safe re-sync

- [ ] Click "Sync now" again immediately. Confirm `ordersCreated: 0` this
      time, and the orders table still shows exactly one row for that
      purchase (no duplicate).

## 5. Cancellation reconciliation

- [ ] Cancel that test order from your Etsy Shop Manager (Orders &
      Shipping).
- [ ] Click "Sync now". Confirm the order's Payment State flips to
      "canceled" and the row is **not** deleted.

## 6. Self-serve guard

- [ ] With `mto_settings.enabled` still true and the cutover time still in
      the past, try to activate a self-serve account
      (`/login.html` → order-number flow) using the **same** test receipt
      number from section 3. Confirm you get the "This order is being
      custom-made for you" message, not account approval.
- [ ] Confirm an **old** receipt number (from before the cutover time —
      use one from a previous, pre-conversion test purchase if you have
      one on file) still activates a self-serve account normally.

## 7. Multiple units and missing info (optional, only if you can test cheaply)

- [ ] If your test purchase can use quantity 2+, confirm that order shows
      "Needs Attention: multiple_units."
- [ ] If you can leave the product-link question blank, confirm that order
      shows "Needs Attention: missing_information."

## After this QA

- [ ] Set `mto_settings.enabled` back to `false` (or leave it on, if this
      was the real go-live run) and confirm the existing self-serve flow
      (`docs/qa-full-account-flow.md`) still passes unaffected.
