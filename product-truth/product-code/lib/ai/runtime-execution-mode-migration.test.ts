import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260721032554_wp02_execution_mode_truth.sql',
  ),
  'utf8',
)
const nullFixMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260721032827_wp02_execution_mode_not_null_fix.sql',
  ),
  'utf8',
)

describe('WP02 route versus pinned execution truth migration', () => {
  it('stores execution semantics outside caller-controlled JSON metadata', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS execution_mode TEXT')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS pinned_model_catalog_entry_id TEXT')
    expect(migration).not.toMatch(/request_meta\s*->/i)
  })

  it('keeps route and pinned evidence mutually exclusive for new plan-linked rows', () => {
    expect(migration).toContain('model_invocations_execution_mode_check')
    expect(migration).toContain("execution_mode = 'route'")
    expect(migration).toContain("execution_mode = 'pinned'")
    expect(migration).toContain('attempt_no = 1')
    expect(migration).toContain('pinned_model_catalog_entry_id = model_catalog_entry_id')
    expect(migration).toContain('NOT VALID')
    expect(migration).not.toMatch(/UPDATE\s+public\.model_invocations/i)
  })

  it('rejects SQL NULL mode explicitly in a forward-only corrective migration', () => {
    expect(nullFixMigration).toContain(
      'DROP CONSTRAINT IF EXISTS model_invocations_execution_mode_check',
    )
    expect(nullFixMigration).toContain('AND execution_mode IS NOT NULL')
    expect(nullFixMigration).toContain(') NOT VALID;')
    expect(nullFixMigration).not.toMatch(/UPDATE\s+public\.model_invocations/i)
  })

  it('indexes only route executions for current published-route verification', () => {
    expect(migration).toContain('idx_model_invocations_review_route_execution')
    expect(migration).toContain("execution_mode = 'route'")
  })
})
