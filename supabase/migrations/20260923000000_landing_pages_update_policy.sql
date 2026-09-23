-- Lets a buyer fix typos in their own generated landing page's text after
-- the fact, via PATCH /api/landing-pages/:id. Without this, "Users can view
-- their own landing pages" (select) and "...within their allowance" (insert)
-- are the only policies on this table -- an update from the caller's own
-- session would be silently rejected by RLS with no matching policy.
create policy "Users can update their own landing pages"
  on public.landing_pages for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
