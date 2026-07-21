import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260721222000_wp04_defer_page_map_source_fence.sql',
  ),
  'utf8',
)

describe('WP04 page-map source fence migration', () => {
  it('checks the final current source identity at transaction completion', () => {
    expect(migration).toContain('create constraint trigger trg_contract_page_map_current_source')
    expect(migration).toContain('after insert or update')
    expect(migration).toContain('deferrable initially deferred')
    expect(migration).toContain('source_version.id = contract.current_version_id')
    expect(migration).toContain('new.contract_version_id is distinct from current_version_id')
  })

  it('does not classify a deterministic identity mismatch as retryable serialization', () => {
    expect(migration).toContain("errcode = '23514'")
    expect(migration).not.toContain("errcode = '40001'")
    expect(migration).toContain('contract_version_match=%s')
    expect(migration).toContain('projected_text_match=%s')
  })

  it('keeps the privileged guard unavailable to browser roles', () => {
    expect(migration).toContain(
      'revoke all on function public.enforce_current_contract_page_map_source()',
    )
    expect(migration).toContain('from public, anon, authenticated;')
    expect(migration).toContain('to service_role;')
  })
})
