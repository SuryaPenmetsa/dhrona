-- Per-learning-profile instructions specifically for suggested follow-up questions.

alter table public.learning_profiles
  add column if not exists suggestion_question_instructions_rich_text text not null default '';
