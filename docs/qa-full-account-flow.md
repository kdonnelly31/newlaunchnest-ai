# Manual QA: Full Account Flow

A step-by-step script for manually testing the entire buyer journey, start to finish. Use this after any change touching login, purchase verification, page allowance, or the admin panel.

**Before you start:**
- Use a **fresh Incognito/private window** for every "buyer" step below — never reuse a tab where you're logged in as admin, and always type `launchnestai.com` directly (not the `.vercel.app` address).
- Have a **real Etsy order number** ready for each purchase step (guest checkout is fine, no Etsy login needed to buy).
- Know where to check results: `/admin.html` (Landing Pages column, Status, Etsy Shop) and Supabase → Authentication → Users (for deleting test accounts between runs).

---

## 1. First-time purchase and signup

- [ ] Buy the LaunchNestAI listing on Etsy as a guest, using a test email you haven't used before.
- [ ] Fill in the **"Your Etsy Shop Name"** personalization field at checkout with a real, active Etsy shop name.
- [ ] Note the Etsy order number from the confirmation.
- [ ] Go to `launchnestai.com/login.html`, enter the test email, click **Send Code**.
- [ ] Check email — confirm it shows a **plain numeric code**, no clickable link.
- [ ] Enter the code → confirm you land on **"Almost there"** with an order-number form (not bounced back to login).
- [ ] Enter the order number → click **Verify Purchase**.
- [ ] Confirm it succeeds and you land on **"Find My Shop"**.
- [ ] Check `/admin.html`: this account's **Status = approved**, **Etsy Shop** is auto-filled (no manual typing needed), **Landing Pages = 0/3 (3 left)**.

**Expected failure paths to spot-check:**
- [ ] A non-numeric or made-up order number shows **"Order Not Found"** with links to buy/contact support.
- [ ] Submitting the *same* order number from a second, different account shows **"already been used to activate another account."**

---

## 2. Creating and viewing landing pages

- [ ] On "Find My Shop," confirm the shop search box is **pre-filled and locked** (not editable) with the shop name from step 1.
- [ ] Select a listing, click **Create Landing Page**.
- [ ] Confirm a new tab opens with the finished page (public, no login required to view it there).
- [ ] Confirm the "page(s) left" counter decreased by 1.
- [ ] Click **My Landing Pages** — confirm the new page appears with a thumbnail, title, and working **Copy link** / **Share** / **View page** actions.
- [ ] Log out, then visit the page's `/p/:id` URL directly (logged out) — confirm it still loads.

---

## 3. Returning login (already approved)

- [ ] Log out completely.
- [ ] Log back in with the same email (new code each time).
- [ ] Confirm it goes **straight to "Find My Shop"** — no order-number prompt, no repeat purchase.

---

## 4. Running out of pages

- [ ] Create landing pages until the account hits **0/3 (0 left)** in `/admin.html`.
- [ ] Log out and back in (or refresh) — confirm you now see **"You're out of Landing Pages"** instead of "Find My Shop."
- [ ] Confirm there's a **"View my existing landing pages →"** link on this screen, and it correctly opens My Landing Pages (you should NOT be locked out of pages you already made).
- [ ] Confirm the top-right nav text (page count / My Landing Pages / Admin / Log out) doesn't overlap or run together.

---

## 5. Repurchase (buying more pages)

- [ ] While on the "You're out of Landing Pages" screen, buy the listing again on Etsy (a **new**, different order number).
- [ ] Enter the new order number and submit.
- [ ] Confirm it succeeds and lands you on **"Find My Shop"**.
- [ ] Check `/admin.html`: **Landing Pages** should now read **3/6 (3 left)** — used stays the same, total goes up by 3.
- [ ] Confirm **Etsy Shop** and **Status** are unchanged (repurchase never re-approves or overwrites the shop name unless it was empty).

---

## 6. Declined account (edge case, admin-only setup)

Since there's no UI button for this anymore, set it up directly in Supabase → Table Editor → `profiles` → set that row's `status` to `declined`.

- [ ] Log in as that account — confirm you see **"Account access declined. Contact support if this is a mistake."** with no order-number form, just a Log out link.

---

## 7. Admin panel spot-check

- [ ] No **Approve/Decline** buttons anywhere in the table.
- [ ] **Etsy Shop** field + **Save** button work (manual override still functions).
- [ ] **Grant Pages** button still manually adds pages when used.
- [ ] **Landing Pages** column header (not "Pages") shows the "used/total (remaining left)" format.
- [ ] **My Landing Pages** and **Log out** links present at the top of the admin page and work.
- [ ] Etsy connection status line reads **"Etsy connected (shop ID ...)"** — if it ever says "not connected," every purchase verification will silently fail.

---

## Known gotchas to keep in mind while testing

- `launchnestai.com` and the raw `newlaunchnest-ai.vercel.app` address are **separate sessions** to the browser — don't switch between them mid-test.
- Test emails on **Outlook/Hotmail/Microsoft 365** may behave differently under corporate link-scanning policies for *other* things, but the code-based login itself should now work the same regardless of provider.
- Deleting a test account only from the `profiles` table (not from Authentication → Users) leaves a broken "No profile found for this account" state — always delete from **Authentication → Users** to fully reset a test account.
