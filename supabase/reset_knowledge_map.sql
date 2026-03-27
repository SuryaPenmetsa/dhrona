-- Reset all knowledge map data and re-seed IB key concepts.
-- Run order matters due to foreign key: concept_connections → wtr_uploads.

BEGIN;

DELETE FROM learning_gaps;
DELETE FROM concept_connections;
DELETE FROM concepts;
DELETE FROM wtr_uploads;

INSERT INTO concepts (name, type) VALUES
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

COMMIT;
