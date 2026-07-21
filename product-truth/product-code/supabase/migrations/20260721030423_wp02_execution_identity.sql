BEGIN;

-- One immutable execution identity groups all real provider attempts produced
-- by one executeAIUsePoint call.  There is deliberately no database default:
-- a per-row default would split one ordered fallback chain into unrelated runs.
ALTER TABLE public.model_invocations
  ADD COLUMN IF NOT EXISTS execution_id UUID;

-- 20260721020919 is already present in Preview.  Historical plan-linked rows
-- may therefore lack an execution_id, and there is no truthful way to infer
-- which of those rows belonged to one call.  NOT VALID preserves that history
-- without fabricating groups while still enforcing the invariant for every new
-- insert or update after this migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'model_invocations_execution_identity_check'
      AND conrelid = 'public.model_invocations'::regclass
  ) THEN
    ALTER TABLE public.model_invocations
      ADD CONSTRAINT model_invocations_execution_identity_check
      CHECK (
        (plan_snapshot_id IS NULL AND execution_id IS NULL)
        OR
        (plan_snapshot_id IS NOT NULL AND execution_id IS NOT NULL)
      ) NOT VALID;
  END IF;
END
$$;

-- The attempt sequence is unique inside one execution.  This prevents two
-- candidates from both claiming the same position in a fallback chain.
CREATE UNIQUE INDEX IF NOT EXISTS model_invocations_execution_attempt_unique
  ON public.model_invocations(execution_id, attempt_no)
  WHERE execution_id IS NOT NULL;

-- Supports "latest complete execution for this ReviewRun" reads before the
-- caller validates that attempts are the contiguous sequence 1..n.
CREATE INDEX IF NOT EXISTS idx_model_invocations_review_execution_created
  ON public.model_invocations(
    review_id,
    created_at DESC,
    execution_id,
    attempt_no,
    id
  )
  WHERE review_id IS NOT NULL AND execution_id IS NOT NULL;

COMMENT ON COLUMN public.model_invocations.execution_id IS
  'One UUID per executeAIUsePoint call; shared by its ordered attempts. NULL is retained only for historical or unplanned legacy evidence.';

COMMIT;
