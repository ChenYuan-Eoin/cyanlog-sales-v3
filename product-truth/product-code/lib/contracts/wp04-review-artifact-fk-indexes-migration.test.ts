import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260721237000_wp04_review_artifact_fk_indexes.sql',
), 'utf8')

describe('WP04 review artifact foreign-key indexes', () => {
  it('covers every source-version foreign key not indexed by the binding migration', () => {
    expect(migration).toContain('idx_ask_items_contract_version')
    expect(migration).toContain('on public.ask_items(contract_version_id)')
    expect(migration).toContain('idx_report_versions_contract_version')
    expect(migration).toContain('on public.report_versions(contract_version_id)')
    expect(migration.match(/where contract_version_id is not null/g)).toHaveLength(2)
  })
})
