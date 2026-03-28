-- Allow admins to fully configure invited users before signup.

alter table public.allowed_registrations
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists learning_profile_id uuid references public.learning_profiles(id) on delete set null;

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_role text;
  invited_first_name text;
  invited_last_name text;
  invited_learning_profile_id uuid;
  has_admin boolean;
begin
  select ar.role, ar.first_name, ar.last_name, ar.learning_profile_id
  into invited_role, invited_first_name, invited_last_name, invited_learning_profile_id
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

  if invited_first_name is not null or invited_last_name is not null then
    insert into public.user_profiles (user_id, first_name, last_name)
    values (new.id, invited_first_name, invited_last_name)
    on conflict (user_id) do update
      set first_name = excluded.first_name,
          last_name = excluded.last_name;
  end if;

  if invited_learning_profile_id is not null then
    insert into public.user_learning_profiles (user_id, learning_profile_id, assigned_by, assigned_at)
    values (new.id, invited_learning_profile_id, null, now())
    on conflict (user_id) do update
      set learning_profile_id = excluded.learning_profile_id,
          assigned_at = excluded.assigned_at;
  end if;

  if invited_role is not null then
    delete from public.allowed_registrations
    where email = lower(new.email);
  end if;

  return new;
end;
$$;
