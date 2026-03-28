-- Make topic resources and tutor episodes user-owned and shareable.

alter table public.tutor_chat_episodes
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

-- Backfill legacy rows to the earliest admin so existing historical data is still reachable.
update public.tutor_chat_episodes t
set owner_user_id = seed.user_id
from (
  select ur.user_id
  from public.user_roles ur
  where ur.role = 'admin'
  order by ur.created_at asc
  limit 1
) as seed
where t.owner_user_id is null;

create index if not exists idx_tutor_chat_episodes_owner
  on public.tutor_chat_episodes (owner_user_id, created_at desc);

drop index if exists idx_tutor_episode_unique_node;
create unique index if not exists idx_tutor_episode_unique_owner_node
  on public.tutor_chat_episodes (
    owner_user_id,
    child_key,
    map_topic,
    coalesce(map_subject, ''),
    node_name,
    coalesce(node_subject, '')
  );

create table if not exists public.tutor_episode_shares (
  episode_id uuid not null references public.tutor_chat_episodes(id) on delete cascade,
  shared_with_user_id uuid not null references auth.users(id) on delete cascade,
  shared_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (episode_id, shared_with_user_id)
);

create index if not exists idx_tutor_episode_shares_shared_with
  on public.tutor_episode_shares (shared_with_user_id, created_at desc);

alter table public.tutor_episode_shares enable row level security;

drop policy if exists "recipients can read episode shares" on public.tutor_episode_shares;
create policy "recipients can read episode shares"
  on public.tutor_episode_shares
  for select
  using (
    auth.uid() = shared_with_user_id
    or auth.uid() = shared_by_user_id
    or public.is_admin(auth.uid())
  );

drop policy if exists "owners and admins can create episode shares" on public.tutor_episode_shares;
create policy "owners and admins can create episode shares"
  on public.tutor_episode_shares
  for insert
  with check (
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.tutor_chat_episodes e
      where e.id = episode_id
        and e.owner_user_id = auth.uid()
    )
  );

drop policy if exists "owners and admins can delete episode shares" on public.tutor_episode_shares;
create policy "owners and admins can delete episode shares"
  on public.tutor_episode_shares
  for delete
  using (
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.tutor_chat_episodes e
      where e.id = episode_id
        and e.owner_user_id = auth.uid()
    )
  );

alter table public.topic_resources
  add column if not exists note_content text;

alter table public.topic_resources
  drop constraint if exists topic_resources_resource_type_check;
alter table public.topic_resources
  add constraint topic_resources_resource_type_check
  check (resource_type in ('file', 'url', 'note'));

create table if not exists public.topic_resource_shares (
  resource_id uuid not null references public.topic_resources(id) on delete cascade,
  shared_with_user_id uuid not null references auth.users(id) on delete cascade,
  shared_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (resource_id, shared_with_user_id)
);

create index if not exists idx_topic_resource_shares_shared_with
  on public.topic_resource_shares (shared_with_user_id, created_at desc);

alter table public.topic_resource_shares enable row level security;

drop policy if exists "recipients can read topic resource shares" on public.topic_resource_shares;
create policy "recipients can read topic resource shares"
  on public.topic_resource_shares
  for select
  using (
    auth.uid() = shared_with_user_id
    or auth.uid() = shared_by_user_id
    or public.is_admin(auth.uid())
  );

drop policy if exists "owners and admins can create topic resource shares" on public.topic_resource_shares;
create policy "owners and admins can create topic resource shares"
  on public.topic_resource_shares
  for insert
  with check (
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.topic_resources tr
      where tr.id = resource_id
        and tr.created_by = auth.uid()
    )
  );

drop policy if exists "owners and admins can delete topic resource shares" on public.topic_resource_shares;
create policy "owners and admins can delete topic resource shares"
  on public.topic_resource_shares
  for delete
  using (
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.topic_resources tr
      where tr.id = resource_id
        and tr.created_by = auth.uid()
    )
  );

drop policy if exists "authenticated users can read topic resources" on public.topic_resources;
create policy "owners, shared users, and admins can read topic resources"
  on public.topic_resources
  for select
  using (
    created_by = auth.uid()
    or public.is_admin(auth.uid())
    or exists (
      select 1
      from public.topic_resource_shares trs
      where trs.resource_id = id
        and trs.shared_with_user_id = auth.uid()
    )
  );
