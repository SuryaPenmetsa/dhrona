-- Concepts: named ideas that appear in learning sessions
create table concepts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  subject      text,                    -- 'Mathematics', 'Sciences', etc.
  type         text not null default 'topic_concept'
               check (type in (
                 'topic_concept',       -- specific syllabus topic idea
                 'ib_key_concept',      -- one of 16 IB MYP key concepts
                 'cross_subject'        -- bridges multiple subjects
               )),
  grade        text,                    -- '6th Grade'
  created_at   timestamptz default now(),
  unique(name, subject)                 -- no duplicate concept per subject
);

-- Connections: directed edges between concepts
create table concept_connections (
  id               uuid primary key default gen_random_uuid(),
  child_key        text not null check (child_key in ('girl', 'boy')),
  concept_a        text not null,       -- source concept name
  concept_b        text not null,       -- target concept name
  subject_a        text,               -- subject of concept_a
  subject_b        text,               -- subject of concept_b
  relationship     text not null,      -- 'same shape as', 'prerequisite for', 'real example of'
  episode_id       uuid,               -- which session this came from
  created_at       timestamptz default now()
);

-- Gaps: concepts a child doesn't fully understand yet
create table learning_gaps (
  id           uuid primary key default gen_random_uuid(),
  child_key    text not null check (child_key in ('girl', 'boy')),
  concept      text not null,
  subject      text,
  note         text,                   -- what specifically they don't get
  status       text not null default 'open'
               check (status in ('open', 'resolved')),
  episode_id   uuid,
  created_at   timestamptz default now(),
  resolved_at  timestamptz
);

-- Seed: IB MYP 16 Key Concepts
insert into concepts (name, type) values
  ('Change', 'ib_key_concept'),
  ('Communication', 'ib_key_concept'),
  ('Communities', 'ib_key_concept'),
  ('Connections', 'ib_key_concept'),
  ('Creativity', 'ib_key_concept'),
  ('Culture', 'ib_key_concept'),
  ('Development', 'ib_key_concept'),
  ('Form', 'ib_key_concept'),
  ('Global Interactions', 'ib_key_concept'),
  ('Identity', 'ib_key_concept'),
  ('Logic', 'ib_key_concept'),
  ('Perspective', 'ib_key_concept'),
  ('Relationships', 'ib_key_concept'),
  ('Systems', 'ib_key_concept'),
  ('Time Place Space', 'ib_key_concept'),
  ('Scientific Technical Innovation', 'ib_key_concept');

-- Indexes
create index idx_connections_child on concept_connections(child_key);
create index idx_connections_concept_a on concept_connections(concept_a);
create index idx_connections_concept_b on concept_connections(concept_b);
create index idx_gaps_child_status on learning_gaps(child_key, status);

-- RLS: children read only their own rows
alter table concepts enable row level security;
alter table concept_connections enable row level security;
alter table learning_gaps enable row level security;

create policy "concepts readable by all authenticated"
  on concepts for select using (auth.role() = 'authenticated');

create policy "connections: child sees own, parent sees all"
  on concept_connections for select using (
    auth.jwt()->>'child_key' = child_key
    or auth.jwt()->>'role' = 'parent'
  );

create policy "connections: insert by authenticated"
  on concept_connections for insert with check (auth.role() = 'authenticated');

create policy "gaps: child sees own, parent sees all"
  on learning_gaps for select using (
    auth.jwt()->>'child_key' = child_key
    or auth.jwt()->>'role' = 'parent'
  );

create policy "gaps: insert by authenticated"
  on learning_gaps for insert with check (auth.role() = 'authenticated');

create policy "gaps: update status"
  on learning_gaps for update using (auth.role() = 'authenticated');
