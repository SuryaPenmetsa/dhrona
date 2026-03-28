-- Persist tutor conversations per map topic + node so learners can revisit episodes later.

create table if not exists tutor_chat_episodes (
  id uuid primary key default gen_random_uuid(),
  child_key text not null default 'curriculum',
  map_topic text not null,
  map_subject text,
  node_name text not null,
  node_subject text,
  node_kind text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table if not exists tutor_chat_messages (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references tutor_chat_episodes(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  context jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_tutor_episode_unique_node
  on tutor_chat_episodes (
    child_key,
    map_topic,
    coalesce(map_subject, ''),
    node_name,
    coalesce(node_subject, '')
  );

create index if not exists idx_tutor_episode_last_message
  on tutor_chat_episodes(last_message_at desc nulls last);

create index if not exists idx_tutor_messages_episode_created
  on tutor_chat_messages(episode_id, created_at asc);
