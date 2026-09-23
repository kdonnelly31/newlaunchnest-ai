-- Lets a buyer delete their own generated landing page from Manage My
-- Landing Pages. Nothing else references landing_pages.id as a foreign
-- key, so a plain row delete is safe with no cascade cleanup needed. Since
-- create_landing_page_allowed's `remaining` is computed live by counting
-- the caller's landing_pages rows, deleting one also frees up a page slot
-- automatically -- no separate allowance bookkeeping required.
create policy "Users can delete their own landing pages"
  on public.landing_pages for delete
  using (user_id = auth.uid());
