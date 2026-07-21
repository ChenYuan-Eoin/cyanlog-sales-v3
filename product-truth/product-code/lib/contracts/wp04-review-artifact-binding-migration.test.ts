import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260721230000_wp04_review_artifact_binding.sql',
), 'utf8')

describe('WP04 review artifact binding migration', () => {
  it('binds annotations, negotiation tasks and reports to one review and source version', () => {
    for (const table of ['contract_annotations', 'ask_items', 'report_versions']) {
      expect(migration).toContain(`alter table public.${table}`)
    }
    expect(migration).toContain('add column if not exists review_id uuid')
    expect(migration).toContain('add column if not exists contract_version_id uuid')
    expect(migration).toContain("binding_state text not null default 'legacy_unbound'")
    expect(migration).toContain('review artifact identity crosses contract or source version')
  })

  it('quarantines ambiguous legacy rows instead of assigning the latest review', () => {
    expect(migration).toContain("binding_state = 'legacy_unbound'")
    expect(migration).toContain('having count(*) = 1')
    expect(migration).not.toContain('order by review.created_at desc limit 1')
  })

  it('moves ASK and report uniqueness from contract scope to review scope', () => {
    expect(migration).toContain('idx_ask_items_review_code_bound')
    expect(migration).toContain('on public.ask_items(review_id, ask_code)')
    expect(migration).toContain('idx_report_versions_review_version_bound')
    expect(migration).toContain('on public.report_versions(review_id, version)')
    expect(migration).toContain('idx_report_versions_review_current_bound')
  })
})
