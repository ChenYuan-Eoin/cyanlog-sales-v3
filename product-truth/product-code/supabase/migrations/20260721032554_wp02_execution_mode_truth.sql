BEGIN;

-- Route executions prove the published ordered policy.  Pinned executions are
-- single-model probes only and must never be interpreted as route verification.
-- These are first-class columns rather than request_meta hints so readers do
-- not have to trust arbitrary JSON supplied by callers.
ALTER TABLE public.model_invocations
  ADD COLUMN IF NOT EXISTS execution_mode TEXT,
  ADD COLUMN IF NOT EXISTS pinned_model_catalog_entry_id TEXT;

-- Earlier WP02 Preview attempts predate these semantics.  Their mode cannot be
-- inferred safely from request_meta, so keep them explicitly unclassified.
-- NOT VALID preserves those rows while enforcing this contract on every new
-- plan-linked insert/update after the migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'model_invocations_execution_mode_check'
      AND conrelid = 'public.model_invocations'::regclass
  ) THEN
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
  END IF;
END
$$;

-- The runtime truth screen asks for the latest complete route execution for a
-- ReviewRun.  Pinned probes are intentionally excluded from this access path.
CREATE INDEX IF NOT EXISTS idx_model_invocations_review_route_execution
  ON public.model_invocations(
    review_id,
    created_at DESC,
    execution_id,
    attempt_no,
    id
  )
  WHERE review_id IS NOT NULL AND execution_mode = 'route';

COMMENT ON COLUMN public.model_invocations.execution_mode IS
  'route executes the published ordered policy; pinned is a single-model probe and is never route verification.';
COMMENT ON COLUMN public.model_invocations.pinned_model_catalog_entry_id IS
  'ModelCatalogEntry explicitly probed by a pinned execution; NULL for route executions and legacy unclassified evidence.';

COMMIT;
