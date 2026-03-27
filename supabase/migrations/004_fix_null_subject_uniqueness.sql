-- Fix: unique(name, subject) does not prevent duplicates when subject IS NULL
-- in Postgres, because NULL != NULL in unique constraints.
-- The seeded IB key concepts have subject = NULL, so duplicates could accumulate.
--
-- Solution: create a unique index using COALESCE to treat NULL as empty string,
-- then drop the original table-level constraint.

-- First, deduplicate any existing NULL-subject rows (keep the oldest)
delete from concepts
where id in (
  select id from (
    select id,
           row_number() over (partition by name, coalesce(subject, '') order by created_at asc) as rn
    from concepts
  ) ranked
  where rn > 1
);

-- Drop the original unique constraint
alter table concepts drop constraint if exists concepts_name_subject_key;

-- Create a proper unique index that handles NULLs
create unique index idx_concepts_name_subject_unique
  on concepts (name, coalesce(subject, ''));
