-- Profiles table: stores app-specific user info, linked 1-to-1 with Supabase Auth's auth.users table.
-- auth.users is managed by Supabase itself (handles email/password, hashing, sessions) and
-- shouldn't be modified directly -- this table holds everything else about the user.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  company_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Row Level Security: locks the table down so, by default, nobody can read or write any row.
-- The policies below then open up exactly the access each user should have to their OWN row.
alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Keeps updated_at current whenever a profile row is edited.
create function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at
  before update on public.profiles
  for each row
  execute function public.handle_updated_at();

-- Auto-creates a profile row the moment someone signs up, so profiles always stays in sync
-- with auth.users without any manual work in the app.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
