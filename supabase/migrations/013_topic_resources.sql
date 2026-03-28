-- Topic-level files and links for study materials.

create table if not exists public.topic_resources (
  id uuid primary key default gen_random_uuid(),
  topic_title text not null,
  topic_subject text,
  resource_type text not null check (resource_type in ('file', 'url')),
  label text,
  url text,
  file_name text,
  storage_bucket text,
  storage_path text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_topic_resources_topic
  on public.topic_resources (topic_title, topic_subject, created_at desc);

create index if not exists idx_topic_resources_created_by
  on public.topic_resources (created_by, created_at desc);

alter table public.topic_resources enable row level security;

drop policy if exists "authenticated users can read topic resources" on public.topic_resources;
create policy "authenticated users can read topic resources"
  on public.topic_resources
  for select
  using (auth.uid() is not null);

drop policy if exists "authenticated users can insert topic resources" on public.topic_resources;
create policy "authenticated users can insert topic resources"
  on public.topic_resources
  for insert
  with check (auth.uid() = created_by);

drop policy if exists "owners and admins can update topic resources" on public.topic_resources;
create policy "owners and admins can update topic resources"
  on public.topic_resources
  for update
  using (created_by = auth.uid() or public.is_admin(auth.uid()))
  with check (created_by = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "owners and admins can delete topic resources" on public.topic_resources;
create policy "owners and admins can delete topic resources"
  on public.topic_resources
  for delete
  using (created_by = auth.uid() or public.is_admin(auth.uid()));

insert into storage.buckets (id, name, public)
values ('topic-resources', 'topic-resources', false)
on conflict (id) do nothing;
