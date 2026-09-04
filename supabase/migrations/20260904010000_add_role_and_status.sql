-- Adds role and status to profiles. Both are locked down (see grants below) so a
-- logged-in user can view their own role/status but cannot change it themselves --
-- only an admin (working directly in Supabase, or through a future admin panel
-- using the service role key) can approve/decline a user or change their role.

alter table public.profiles
  add column role text not null default 'user' check (role in ('admin', 'user')),
  add column status text not null default 'requested' check (status in ('approved', 'declined', 'requested'));

revoke update on public.profiles from authenticated;
grant update (full_name, company_name, avatar_url) on public.profiles to authenticated;
