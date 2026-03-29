-- Composite indexes for frequently used query patterns.

-- Topic-chain BFS: filters child_key + concept_a or concept_b together
create index if not exists idx_connections_child_concept_a
  on public.concept_connections (child_key, concept_a);
create index if not exists idx_connections_child_concept_b
  on public.concept_connections (child_key, concept_b);

-- Graph context: connections filtered by child_key + subject
create index if not exists idx_connections_child_subject_a
  on public.concept_connections (child_key, subject_a);
create index if not exists idx_connections_child_subject_b
  on public.concept_connections (child_key, subject_b);

-- Concepts filtered by subject (admin graph, context)
create index if not exists idx_concepts_subject
  on public.concepts (subject);

-- Concepts filtered by type (cross_subject lookups in context)
create index if not exists idx_concepts_type
  on public.concepts (type) where type = 'cross_subject';

-- Learning gaps: batch resolve uses child_key + concept + status
create index if not exists idx_gaps_child_concept_status
  on public.learning_gaps (child_key, concept, status);

-- User learning profiles: profile resolution join
create index if not exists idx_user_learning_profiles_user
  on public.user_learning_profiles (user_id);

-- Timeline: curriculum_schedule filtered by subject + week range
create index if not exists idx_schedule_subject_weeks
  on public.curriculum_schedule (subject, week_start, week_end);
