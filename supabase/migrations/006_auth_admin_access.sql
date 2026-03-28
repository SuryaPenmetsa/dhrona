-- Auth roles + controlled registration (invite-only after first admin exists).

create table if not exists user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (email = lower(email)),
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists allowed_registrations (
  email text primary key check (email = lower(email)),
  role text not null default 'member' check (role in ('admin', 'member')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_roles_updated_at on user_roles;
create trigger trg_user_roles_updated_at
before update on user_roles
for each row
execute function set_updated_at_timestamp();

create or replace function is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = uid
      and ur.role = 'admin'
  );
$$;

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_role text;
  has_admin boolean;
begin
  select ar.role
  into invited_role
  from public.allowed_registrations ar
  where ar.email = lower(new.email)
  limit 1;

  select exists(select 1 from public.user_roles where role = 'admin') into has_admin;

  if invited_role is null and has_admin then
    raise exception 'Registration is invite-only. Ask an admin to approve your email first.';
  end if;

  insert into public.user_roles (user_id, email, role)
  values (
    new.id,
    lower(new.email),
    coalesce(invited_role, case when has_admin then 'member' else 'admin' end)
  )
  on conflict (user_id) do update
    set email = excluded.email;

  if invited_role is not null then
    delete from public.allowed_registrations
    where email = lower(new.email);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function handle_new_auth_user();

-- Backfill existing auth users. First user becomes admin, remaining are members.
with ordered as (
  select
    u.id as user_id,
    lower(u.email) as email,
    row_number() over (order by u.created_at asc, u.id asc) as rn
  from auth.users u
  where u.email is not null
)
insert into public.user_roles (user_id, email, role)
select
  o.user_id,
  o.email,
  case when o.rn = 1 then 'admin' else 'member' end
from ordered o
on conflict (user_id) do update
  set email = excluded.email;

do $$
begin
  if not exists (select 1 from public.user_roles where role = 'admin') then
    update public.user_roles
    set role = 'admin'
    where user_id = (
      select ur.user_id
      from public.user_roles ur
      order by ur.created_at asc, ur.user_id asc
      limit 1
    );
  end if;
end $$;

alter table public.user_roles enable row level security;
alter table public.allowed_registrations enable row level security;

drop policy if exists "users can read own role" on public.user_roles;
create policy "users can read own role"
  on public.user_roles
  for select
  using (auth.uid() = user_id);

drop policy if exists "admins can read all roles" on public.user_roles;
create policy "admins can read all roles"
  on public.user_roles
  for select
  using (public.is_admin(auth.uid()));

drop policy if exists "admins can manage roles" on public.user_roles;
create policy "admins can manage roles"
  on public.user_roles
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "admins can manage registration allowlist" on public.allowed_registrations;
create policy "admins can manage registration allowlist"
  on public.allowed_registrations
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
