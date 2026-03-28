-- Admin-managed LLM model selection for tutor and profile generation.

create table if not exists llm_settings (
  id boolean primary key default true check (id = true),
  tutor_model_id text not null default 'claude-sonnet-4-20250514',
  profile_generation_model_id text not null default 'claude-sonnet-4-20250514',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_llm_settings_updated_at on llm_settings;
create trigger trg_llm_settings_updated_at
before update on llm_settings
for each row
execute function set_updated_at_timestamp();

insert into llm_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.llm_settings enable row level security;

drop policy if exists "admins can manage llm settings" on public.llm_settings;
create policy "admins can manage llm settings"
  on public.llm_settings
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
