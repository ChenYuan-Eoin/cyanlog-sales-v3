import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260721239000_wp04_current_review_artifact_mutation.sql',
), 'utf8')
const canary = readFileSync(join(
  process.cwd(),
  'lib/contracts/canaries/wp04-current-review-artifact-mutation-canary.sql',
), 'utf8')

describe('WP04 current-review ASK mutation fence', () => {
  it('serializes ASK writes with the current source and latest review identity', () => {
    expect(migration).toContain('create or replace function public.enforce_current_review_ask_mutation()')
    expect(migration).toContain('for share')
    expect(migration).toContain('current_version_id is distinct from new.contract_version_id')
    expect(migration).toContain('order by review.created_at desc nulls last, review.id desc')
    expect(migration).toContain('latest_review_id is distinct from new.review_id')
    expect(migration).toContain('ASK mutation requires the latest review for the current source version')
  })

  it('covers creation and every business status transition while leaving quarantined history inert', () => {
    expect(migration).toContain('if new.binding_state is distinct from \'bound\' then')
    expect(migration).toContain('before insert or update of')
    for (const column of [
      'status',
      'response_id',
      'closed_by',
      'closed_reason',
      'review_id',
      'contract_version_id',
      'binding_state',
    ]) {
      expect(migration).toContain(`  ${column}`)
    }
  })

  it('ships a rollback-only Preview canary for current review and source fences', () => {
    expect(canary).toContain('historical ReviewRun ASK mutation unexpectedly succeeded')
    expect(canary).toContain('non-current source ASK mutation unexpectedly succeeded')
    expect(canary).toContain("'historical_review_immutable', true")
    expect(canary).toContain("'current_review_mutable', true")
    expect(canary).toContain("'non_current_source_immutable', true")
    expect(canary.trimEnd()).toMatch(/rollback;$/)
  })
})
