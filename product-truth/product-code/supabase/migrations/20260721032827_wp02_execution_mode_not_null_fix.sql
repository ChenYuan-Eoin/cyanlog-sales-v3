BEGIN;

-- PostgreSQL CHECK constraints accept NULL results.  The first execution-mode
-- migration compared a nullable execution_mode directly, so an unclassified
-- plan-linked row could evaluate to NULL instead of FALSE.  Replace the
-- constraint atomically and make the non-null requirement explicit.
ALTER TABLE public.model_invocations
  DROP CONSTRAINT IF EXISTS model_invocations_execution_mode_check;

ALTER TABLE public.model_invocations
  ADD CONSTRAINT model_invocations_execution_mode_check
  CHECK (
    (
      plan_snapshot_id IS NULL
      AND execution_id IS NULL
      AND execution_mode IS NULL
      AND pinned_model_catalog_entry_id IS NULL
    )
    OR
    (
      plan_snapshot_id IS NOT NULL
      AND execution_id IS NOT NULL
      AND execution_mode IS NOT NULL
      AND (
        (
          execution_mode = 'route'
          AND pinned_model_catalog_entry_id IS NULL
        )
        OR
        (
          execution_mode = 'pinned'
          AND attempt_no = 1
          AND pinned_model_catalog_entry_id IS NOT NULL
          AND pinned_model_catalog_entry_id = model_catalog_entry_id
          AND pinned_model_catalog_entry_id ~ '^[a-z][a-z0-9._-]{1,99}$'
        )
      )
    )
  ) NOT VALID;

COMMIT;
