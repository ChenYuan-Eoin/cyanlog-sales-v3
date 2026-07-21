import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260721030423_wp02_execution_identity.sql',
  ),
  'utf8',
)

describe('WP02 execution identity incremental migration', () => {
  it('adds an explicit UUID execution identity without a per-attempt default', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS execution_id UUID')
    expect(migration).not.toMatch(/execution_id\s+UUID\s+DEFAULT/i)
  })

  it('enforces identity for new plan-linked evidence without inventing historical groups', () => {
    expect(migration).toContain('model_invocations_execution_identity_check')
    expect(migration).toContain('(plan_snapshot_id IS NOT NULL AND execution_id IS NOT NULL)')
    expect(migration).toContain('NOT VALID')
    expect(migration).not.toMatch(/UPDATE\s+public\.model_invocations/i)
  })

  it('makes attempt positions unique inside an execution and indexes recent ReviewRun reads', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS model_invocations_execution_attempt_unique')
    expect(migration).toContain('ON public.model_invocations(execution_id, attempt_no)')
    expect(migration).toContain('idx_model_invocations_review_execution_created')
  })
})
