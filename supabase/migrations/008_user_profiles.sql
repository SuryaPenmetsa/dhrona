-- Basic editable user profile fields for admin management.

create table if not exists user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_user_profiles_updated_at on user_profiles;
create trigger trg_user_profiles_updated_at
before update on user_profiles
for each row
execute function set_updated_at_timestamp();

alter table public.user_profiles enable row level security;

drop policy if exists "users can read own profile row" on public.user_profiles;
create policy "users can read own profile row"
  on public.user_profiles
  for select
  using (auth.uid() = user_id);

drop policy if exists "users can update own profile row" on public.user_profiles;
create policy "users can update own profile row"
  on public.user_profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "admins can manage all user profile rows" on public.user_profiles;
create policy "admins can manage all user profile rows"
  on public.user_profiles
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
