import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260721234000_wp04_repair_release_invariants.sql'),
  'utf8',
)
const previewCanary = readFileSync(
  join(process.cwd(), 'lib/contracts/canaries/wp04-release-invariants-canary.sql'),
  'utf8',
)

describe('WP04 release invariant forward repair', () => {
  it('recreates the missing source and ReviewRun identity triggers in the tracked lineage', () => {
    expect(migration).toContain('create or replace function public.prevent_active_review_source_mutation()')
    expect(migration).toContain('create trigger trg_contract_source_active_review_lock')
    expect(migration).toContain(
      'create or replace function public.enforce_current_contract_review_source_identity()',
    )
    expect(migration).toContain('create trigger trg_contract_review_run_source_identity')
    expect(migration).toContain('new.contract_version_id is distinct from current_version_id')
    expect(migration).toContain('page_map.contract_version_id = version.id')
    expect(migration).toContain(
      "to_regclass('public.contract_review_submission_batches')",
    )
    expect(migration).toContain(
      'execute function public.enforce_current_contract_review_source_identity()',
    )
  })

  it('repairs only the six deterministic state-fence routines and rejects missing definitions', () => {
    for (const routineName of [
      'finalize_contract_source_version',
      'start_initial_contract_review',
      'start_initial_contract_review_fenced',
      'mark_contract_analysis_job_running',
      'mark_contract_analysis_job_completed',
      'mark_contract_analysis_job_failed',
    ]) {
      expect(migration).toContain(`'${routineName}'`)
    }
    expect(migration).toContain("'40001',\n      '23514'")
    expect(migration).toContain('one or more WP04 state-fence functions are missing')
    expect(migration).toContain('WP04 deterministic state fence still exposes SQLSTATE 40001')
  })

  it('dynamically proves source and worker conflicts are non-retryable', () => {
    expect(previewCanary).toContain('from public.start_initial_contract_review_fenced(')
    expect(previewCanary).toContain('from public.mark_contract_analysis_job_running(')
    expect(previewCanary).toContain("when sqlstate '40001' then")
    expect(previewCanary.match(/when sqlstate '23514' then null;/g)).toHaveLength(4)
    expect(previewCanary).toContain("'deterministic_conflict_sqlstate', '23514'")
    expect(previewCanary.trimEnd()).toMatch(/rollback;$/)
  })

  it('proves valid source binding and rejects stale mutation and ReviewRun identity', () => {
    expect(previewCanary).toContain(
      "set current_version_id = 'c2000000-0000-4000-8000-000000000001'",
    )
    expect(previewCanary).toContain('source mutation without a new version unexpectedly succeeded')
    expect(previewCanary).toContain('mismatched ReviewRun source identity unexpectedly succeeded')
  })
})
