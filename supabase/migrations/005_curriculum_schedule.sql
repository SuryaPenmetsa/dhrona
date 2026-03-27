-- Curriculum schedule: maps each concept to the week it was taught or planned.
-- Derived from WTR files — one row per concept per week appearance.

CREATE TABLE curriculum_schedule (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_name   TEXT NOT NULL,
  subject        TEXT NOT NULL,
  week_start     DATE NOT NULL,
  week_end       DATE NOT NULL,
  schedule_type  TEXT NOT NULL CHECK (schedule_type IN ('current', 'coming')),
  grade          TEXT,
  wtr_upload_id  UUID REFERENCES wtr_uploads(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),

  UNIQUE (concept_name, subject, week_start, schedule_type)
);

CREATE INDEX idx_schedule_week ON curriculum_schedule (week_start, week_end);
CREATE INDEX idx_schedule_subject ON curriculum_schedule (subject);
CREATE INDEX idx_schedule_concept ON curriculum_schedule (concept_name);
CREATE INDEX idx_schedule_type ON curriculum_schedule (schedule_type);

ALTER TABLE curriculum_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedule readable by authenticated"
  ON curriculum_schedule FOR SELECT USING (auth.role() = 'authenticated');
