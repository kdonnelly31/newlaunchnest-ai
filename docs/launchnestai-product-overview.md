# LaunchNestAI — What It Does (Product Reference)

*Written as reference material for brainstorming new products to build or integrate alongside LaunchNestAI. Describes the product as it actually works today, not aspirationally.*

---

## 1. One-paragraph summary

LaunchNestAI is a tool **for Etsy sellers**, sold **as a listing on Etsy itself**. A seller buys it, submits their order number, and the app automatically turns any of their own live Etsy listings into a polished, AI-written, shareable landing page — complete with marketing copy, product photos, live pricing/availability pulled from Etsy, and ready-to-post social media captions. The pitch to the seller: better-looking, better-converting product pages than Etsy's own listing page, to share on social media and drive traffic back to the real Etsy checkout.

---

## 2. Business model & access

- **No separate payment system.** The product *is* an Etsy listing (Kim's own shop, "LaunchNestAI"). Etsy is the entire storefront and payment processor — there's no Stripe, no subscription billing engine.
- **Self-serve activation.** After buying, the seller logs in with just their email (passwordless, a typed numeric code — not a magic link, deliberately, because corporate email link-scanners were silently breaking magic links) and submits their Etsy order number. The server verifies that order number against Kim's own shop's Etsy receipts via the Etsy API.
- **Hard requirement: the buyer must be an Etsy seller themselves.** The whole product only makes sense for someone who has their own shop to promote. The system auto-detects the buyer's own shop directly from Etsy (via their Etsy account ID — not something they type), so in practice this happens with zero manual input for anyone who already has a shop.
  - If someone without a shop buys it, their account is still approved (not rejected/refunded) but sits in a "not linked to a shop yet" state until support fixes it manually. This is a deliberate choice, not a bug — intentionally permissive rather than risking blocking a legitimate buyer.
- **Pages are metered.** Each purchase grants a fixed number of landing pages (e.g. 3). Buying the listing again on Etsy grants more — and the app **automatically detects that repurchase** (matching the buyer's Etsy account, no new order number needed in the common case) and unlocks 3 more pages without the seller doing anything beyond buying again.
- **No manual approval step.** There used to be admin Approve/Decline buttons; the self-serve verification is now reliable enough that this was removed entirely. The admin panel is monitoring/override tooling, not a gate.

---

## 3. The core user journey, start to finish

1. **Purchase.** Seller buys the LaunchNestAI listing on Etsy (guest checkout is fine — no Etsy login required to buy).
2. **Login.** They go to launchnestai.com, enter their email, get a numeric code, type it in.
3. **Verify purchase.** First-time users are prompted for their Etsy order number. The server checks it against Kim's shop's receipts. On success, the account is approved and — using the buyer's own Etsy account ID — their own shop is identified automatically.
4. **Find My Shop.** The seller lands on a shop search screen that's pre-filled and **locked** to their own shop (they can't search anyone else's — the server enforces this, not just the UI). They see a grid of their shop's active listings.
5. **Pick a listing, create a page.** One click. Behind the scenes the server:
   - Pulls the full listing (title, description, photos, materials, tags) from Etsy.
   - Checks Etsy for the **real current price**, including any active sale/discount (Etsy's basic listing data deliberately excludes sale pricing — a separate API call is needed to get it).
   - Sends all of that to Anthropic's Claude to write a structured landing page: a hero section, an emotional "story" section, benefit highlights, lifestyle imagery, product details, trust signals, and a final call-to-action — plus ready-to-use captions for Instagram, Facebook, and Pinterest.
   - Pulls an accent color (and the shop's actual icon, shown in the footer) from the seller's own shop branding, so the page doesn't look like a generic template.
6. **The page itself.** A standalone public page at a permanent URL. No login needed to view it — it's meant to be shared. It shows the AI-written copy, the real (possibly discounted) price, a "Get Yours on Etsy →" button linking straight to checkout, and a "Designed by [Shop] on Etsy" footer credit with the shop's icon.
   - **Every single view re-checks Etsy live** for availability and price. If the listing sells out or gets deactivated, the page automatically swaps to an honest "Sold Out" / "Currently Unavailable" state and redirects the buy button to the shop's main page instead of a dead link — it never silently keeps "selling" something that's gone.
7. **Manage pages.** A "My Landing Pages" screen lists everything the seller has created: copy the shareable link, share directly to Pinterest/Facebook/Instagram with the pre-written caption, lightly edit the AI-generated text (bounded edits — can't change section structure, just wording), or delete.
8. **Running out of pages.** Once the allowance is used up, the seller sees a "buy more" prompt instead of being locked out — and crucially, they **keep access to every page they already made**. Buying again is auto-detected (the app actively polls for it for a few seconds after they return from Etsy) and grants 3 more pages with no new order number typed in.

---

## 4. A second, parallel purchase path: Made-to-Order (MTO) intake

This is a newer, optional mode for a *different kind* of buyer journey — not self-serve, but **custom-built by Kim** from structured personalization answers the buyer fills in at Etsy checkout (which product to promote, who their customer is, what message to send, where they plan to share, and uploaded brand assets/photos). It's controlled by an admin-set "cutover" timestamp: orders placed before that time go through the normal self-serve flow above; orders placed after go into this custom intake queue instead (and get a clear "this is being custom-made for you" message if someone tries to self-serve-activate with that receipt).

A background job syncs new Etsy receipts into an orders queue every 10 minutes (or on-demand), maps each personalization answer to a known field, and flags orders that need human attention — multiple units ordered, missing required info, an unclear product link, or an answer it couldn't map to a known field. This exists as **infrastructure for a more "concierge" tier of the product**, not a fully self-serve feature.

---

## 5. Admin tools (Kim's own panel)

- See every customer: email, approval status, which shop they're linked to, pages used/remaining.
- Manually override a customer's linked shop or grant extra pages (fallback for edge cases the automatic flow can't handle).
- **On-demand live-status check**: for one customer, check all their created pages against Etsy right now and see which are available / sold out / unavailable, without opening each page individually.
- A separate settings screen for the Made-to-Order queue described above (enable/disable, cutover time, trigger a sync, review flagged orders).

---

## 6. Technical building blocks already in place

Useful context for anything new that might plug into this: these integrations already exist and are known-working, so a new product idea doesn't need to rebuild them from scratch.

| Piece | What's already built |
|---|---|
| **Etsy API** | Shop lookup by name *and* by owner's account ID, listing details (single + batch), listing images, **live price including active sales**, live availability, shop's own receipts (for purchase verification), OAuth connection to the seller's (Kim's) own shop. |
| **Anthropic (Claude)** | One-shot, server-side generation of a structured multi-section landing page plan + platform-specific social captions, from a listing's raw Etsy data. Not conversational — it's a single batch generation per page, with constrained post-hoc text editing (not full regeneration) afterward. |
| **Supabase** | Auth (passwordless email-code login), Postgres database (profiles, landing pages, MTO orders), file storage. |
| **Social sharing** | Pre-built share URLs/captions for Pinterest and Facebook, a copy-caption flow for Instagram (no direct posting API — Instagram doesn't allow browser-based posting). A TikTok *posting* API integration exists in the backend (OAuth + video upload) but **isn't wired into any user-facing screen yet** — it's unused capability, not a live feature. |
| **Hosting** | Vercel (serverless functions), custom domain, a cron job for the MTO sync. |
| **Image/branding** | Extracts a dominant brand color from the shop's own icon/banner to theme each page; shows the shop's actual icon on the page. |

---

## 7. Constraints worth knowing before designing something new

- **One shop per seller, enforced server-side.** The whole security model assumes (correctly, per Etsy's own rules) that one Etsy account = one shop. Any new feature that touches shop identity should lean on this, not work around it.
- **Etsy is the only source of truth.** The app deliberately never trusts buyer-typed information (shop name, product link) when Etsy's API can answer the same question directly — repeated bugs came from trusting typed input instead. Any new integration should follow the same instinct.
- **AI generation is a one-shot batch job, not a conversation.** There's no chat interface, no "regenerate this section," no back-and-forth with the AI today — just one generation pass at page-creation time, with manual text tweaks afterward.
- **No billing system beyond Etsy itself.** Anything requiring recurring billing, usage-based pricing, or anything Etsy's own checkout can't express would need new infrastructure — there's currently nothing like Stripe in this stack.
- **The public landing page has no login and minimal JS** — it's intentionally lightweight and fast for an anonymous shopper, with the richer app experience (search, creation, management) gated behind login. A new feature aimed at shoppers (vs. sellers) would need to respect that the public page is a different, much simpler surface than the logged-in app.
- **Social posting is link/caption-based, not API-automated**, except for an unused TikTok posting capability. True auto-posting across platforms isn't a solved problem here yet.
      