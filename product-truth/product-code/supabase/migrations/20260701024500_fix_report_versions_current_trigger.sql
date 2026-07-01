-- F005/F027: keep report_versions current-version rollover compatible with
-- the partial unique index on (contract_id) WHERE is_current = true.
--
-- 20260610000004 created the unique index and an AFTER INSERT trigger. The
-- unique index is checked before an AFTER trigger can clear the previous
-- current row, so inserting a new current version can fail when an old current
-- version exists. Move the rollover to BEFORE INSERT/UPDATE.

CREATE OR REPLACE FUNCTION update_report_version_current()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_current = true THEN
    UPDATE report_versions
    SET is_current = false
    WHERE contract_id = NEW.contract_id
      AND id IS DISTINCT FROM NEW.id
      AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_report_current ON report_versions;

CREATE TRIGGER trigger_update_report_current
  BEFORE INSERT OR UPDATE OF is_current ON report_versions
  FOR EACH ROW
  EXECUTE FUNCTION update_report_version_current();
