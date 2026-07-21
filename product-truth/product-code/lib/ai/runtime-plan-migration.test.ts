import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260721020919_wp02_ai_runtime_plan_truth.sql'
  ),
  'utf8'
)

describe('WP02 AI runtime audit migration', () => {
  it('creates one organization-scoped immutable plan snapshot', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.ai_runtime_plan_snapshots')
    expect(migration).toContain('UNIQUE (org_id, snapshot_sha256)')
    expect(migration).toContain("CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$')")
    expect(migration).toContain('BEFORE UPDATE OR DELETE')
    expect(migration).toContain("RAISE EXCEPTION 'AI_RUNTIME_PLAN_SNAPSHOT_IMMUTABLE'")
  })

  it('allows same-org reads and insert-only service writes', () => {
    expect(migration).toContain('ALTER TABLE public.ai_runtime_plan_snapshots ENABLE ROW LEVEL SECURITY;')
    expect(migration).toContain('membership.user_id = (SELECT auth.uid())')
    expect(migration).toContain('GRANT SELECT ON TABLE public.ai_runtime_plan_snapshots TO authenticated;')
    expect(migration).toContain('GRANT SELECT, INSERT ON TABLE public.ai_runtime_plan_snapshots TO service_role;')
    expect(migration).not.toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_runtime_plan_snapshots'
    )
  })

  it('binds each new invocation to the complete frozen routing identity', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS plan_snapshot_id UUID')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS business_use_point_id TEXT')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS model_catalog_entry_id TEXT')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS provider_connection_id TEXT')
    expect(migration).toContain('model_invocations_runtime_plan_fields_check')
    expect(migration).toContain('model_invocations_runtime_plan_identity_fkey')
    expect(migration).toContain('model_invocations_review_plan_snapshot_fkey')
  })

  it('requires coherent token accounting while retaining null legacy rows', () => {
    expect(migration).toContain('model_invocations_token_accounting_check')
    expect(migration).toContain('model_invocations_completed_usage_check')
    expect(migration).toContain('input_tokens IS NULL')
    expect(migration).toContain('output_tokens IS NULL')
    expect(migration).toContain('total_tokens IS NULL')
    expect(migration).toContain('total_tokens = input_tokens + output_tokens')
    expect(migration).toContain("status NOT IN ('completed', 'degraded')")
    expect(migration).toContain('total_tokens > 0')
  })

  it('binds ReviewRun once and indexes both directions of the evidence chain', () => {
    expect(migration).toContain('ALTER TABLE public.contract_reviews')
    expect(migration).toContain('contract_reviews_plan_snapshot_id_fkey')
    expect(migration).toContain("RAISE EXCEPTION 'CONTRACT_REVIEW_PLAN_SNAPSHOT_IMMUTABLE'")
    expect(migration).toContain('idx_model_invocations_review_plan_attempt')
    expect(migration).toContain('idx_contract_reviews_model_invocation_ids_gin')
  })

  it('keeps ModelPolicy only as historical compatibility and never seeds fake invocation rows', () => {
    expect(migration).toContain('Legacy read-only compatibility pointer')
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\.model_invocations/i)
    expect(migration).not.toMatch(/UPDATE\s+public\.model_invocations/i)
  })
})
