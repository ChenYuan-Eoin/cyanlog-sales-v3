-- F005/F027: report_versions was introduced by two historical migrations.
-- If 20260603000011 created the table first, the later CREATE TABLE IF NOT EXISTS
-- in 20260610000004 did not add no_ask_explanation, while current report APIs
-- already select that column. Keep this migration additive and idempotent.

ALTER TABLE report_versions
  ADD COLUMN IF NOT EXISTS no_ask_explanation TEXT;
