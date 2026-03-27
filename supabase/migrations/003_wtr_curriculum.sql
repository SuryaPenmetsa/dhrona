-- WTR (Weekly Transaction Report) uploads and curriculum-scoped graph edges

create table wtr_uploads (
  id              uuid primary key default gen_random_uuid(),
  filename        text not null,
  period_type     text not null default 'weekly'
                  check (period_type in ('weekly', 'monthly', 'term', 'yearly', 'other')),
  grade           text,
  label           text,
  school_year     text,
  mime_type       text not null,
  file_size_bytes bigint,
  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'completed', 'failed')),
  error_message   text,
  extraction_summary jsonb,
  created_at      timestamptz default now(),
  completed_at    timestamptz
);

create index idx_wtr_uploads_created on wtr_uploads(created_at desc);

-- Curriculum map: not tied to a specific child
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'concept_connections'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%child_key%'
  loop
    execute format('alter table concept_connections drop constraint %I', r.conname);
  end loop;
end $$;

alter table concept_connections
  add constraint concept_connections_child_key_check
  check (child_key in ('girl', 'boy', 'curriculum'));

alter table concept_connections
  add column if not exists wtr_upload_id uuid references wtr_uploads(id) on delete set null;

create index idx_connections_wtr on concept_connections(wtr_upload_id);

-- Allow authenticated users to read school curriculum connections (for tutor context)
drop policy if exists "connections: child sees own, parent sees all" on concept_connections;
create policy "connections: child, parent, or curriculum"
  on concept_connections for select using (
    child_key = 'curriculum'
    or auth.jwt()->>'child_key' = child_key
    or auth.jwt()->>'role' = 'parent'
  );

alter table wtr_uploads enable row level security;

-- No anon policies: access via service role in admin API only.
-- (Authenticated dashboard can be added later with an admin role claim.)
