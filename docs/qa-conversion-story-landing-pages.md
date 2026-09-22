# Manual QA: Conversion Story Landing Page Engine

Run this after any change touching `lib/pageStorySchema.js`,
`lib/pageStoryGenerator.js`, `lib/landingPageTemplate.js`'s v2 path, or the
`/api/landing-pages` handler. Requires: an approved (or admin) account with
at least one linked Etsy shop that has products with real photos.

## 1. Backward compatibility (do this first, before generating anything new)

- [ ] Open an existing landing page you generated *before* this change
      (`/p/:id` for a page created earlier) directly by URL.
- [ ] Confirm it looks pixel-identical to how it looked before -- same hero
      layout, same horizontal image gallery, same fonts/colors.
- [ ] Open `/my-pages.html` -- confirm that page's card still shows its
      original title and, if it has share captions, that the "Share" button
      still opens the same Pinterest/Facebook/Instagram panel as before.

## 2. Generating a new page

- [ ] From "Find My Shop," pick a real product with **several photos** of
      different kinds (at least one clear product shot, and ideally one
      lifestyle/in-use photo if the shop has one).
- [ ] Click "Create Landing Page." Note how long it takes (expect noticeably
      longer than before -- the AI is now analyzing real photos, not just
      text).
- [ ] Confirm the new page loads without error.

## 3. Checking the result is genuinely product-aware, not templated

- [ ] Confirm the hero section's headline/subheadline are specific to this
      product, not generic.
- [ ] Confirm the hero image is a sensible "lead" shot, not an arbitrary
      pick.
- [ ] Scroll the whole page -- confirm the sections present make sense for
      *this* product (e.g. a "Buyer Intent / gift occasions" section should
      only appear if the product is plausibly giftable; a "Trust" section
      should only appear if the listing actually supports a real trust
      claim -- not a generic "handmade with love" filler).
- [ ] Confirm every photo used somewhere on the page is a real photo from
      this listing (open the listing on Etsy in another tab to compare) --
      no broken images, no photo used in a section it obviously doesn't fit
      (e.g. a packaging shot used as the emotional hero image).
- [ ] Confirm no fabricated claim appears anywhere (materials, guarantees,
      shipping promises, review counts, "limited stock," etc.) that isn't
      actually in the Etsy listing's own title/description/tags.

## 4. Mobile check

- [ ] Open the new page on a real phone, or your browser's device-width
      preview at ~375px wide.
- [ ] Confirm the hero message is visible without scrolling, buttons are
      easy to tap, no section overflows horizontally, and image
      grids/cards stack into a single column.

## 5. Sharing still works for the new page

- [ ] On `/my-pages.html`, find the newly created page's card and click
      "Share."
- [ ] Confirm captions appear for Pinterest, Facebook, and Instagram, and
      that "Copy caption" actually copies real, product-specific text (not
      a blank or "undefined -- undefined" fallback).

## 6. Failure path

- [ ] Temporarily use a product with only 1-2 very low-information photos
      (or a listing with a very short description) and generate a page.
      Confirm the app doesn't error, and that the result reasonably omits
      sections that data doesn't support rather than inventing filler.
