import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260721231000_wp04_analysis_artifact_publish.sql',
), 'utf8')

describe('WP04 fenced analysis artifact publication', () => {
  it('locks and validates the active lease before replacing artifacts', () => {
    expect(migration).toContain('publish_contract_analysis_artifacts_fenced')
    expect(migration).toContain("and job.status = 'running'")
    expect(migration).toContain('and job.lock_token = p_lock_token')
    expect(migration).toContain('for update;')
    expect(migration).toContain('current_contract.current_version_id is distinct from artifact_version_id')
    expect(migration).toContain('current_review.contract_version_id is null')
  })

  it('deletes only artifacts owned by the selected ReviewRun', () => {
    expect(migration).toContain('where review_id = p_review_id')
    expect(migration).toContain('and contract_version_id = artifact_version_id')
    expect(migration).not.toMatch(/delete from public\.contract_annotations\s+where contract_id = p_contract_id/)
  })

  it('publishes artifacts, review result and completed job in one transaction', () => {
    expect(migration).toContain('insert into public.contract_risk_cards')
    expect(migration).toContain('insert into public.contract_annotations')
    expect(migration).toContain('insert into public.contract_clauses')
    expect(migration).toContain("status = case when p_degraded then 'DEGRADED' else 'COMPLETED' end")
    expect(migration).toContain("set status = 'completed'")
    expect(migration).toContain('commit;')
    expect(migration).not.toContain("errcode = '40001'")
  })
})
