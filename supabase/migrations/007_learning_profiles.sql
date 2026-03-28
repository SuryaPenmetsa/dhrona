-- Learning profiles for student personalization in tutor responses.

create table if not exists learning_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  personality_summary text,
  llm_instructions_rich_text text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table if not exists user_learning_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  learning_profile_id uuid not null references learning_profiles(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now()
);

drop trigger if exists trg_learning_profiles_updated_at on learning_profiles;
create trigger trg_learning_profiles_updated_at
before update on learning_profiles
for each row
execute function set_updated_at_timestamp();

alter table public.learning_profiles enable row level security;
alter table public.user_learning_profiles enable row level security;

drop policy if exists "admins can manage learning profiles" on public.learning_profiles;
create policy "admins can manage learning profiles"
  on public.learning_profiles
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "users can read assigned learning profile" on public.learning_profiles;
create policy "users can read assigned learning profile"
  on public.learning_profiles
  for select
  using (
    exists (
      select 1
      from public.user_learning_profiles ulp
      where ulp.learning_profile_id = id
        and ulp.user_id = auth.uid()
    )
  );

drop policy if exists "admins can manage user profile assignments" on public.user_learning_profiles;
create policy "admins can manage user profile assignments"
  on public.user_learning_profiles
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "users can read own profile assignment" on public.user_learning_profiles;
create policy "users can read own profile assignment"
  on public.user_learning_profiles
  for select
  using (user_id = auth.uid());
