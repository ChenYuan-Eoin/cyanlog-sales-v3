import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const originalMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260721223000_wp04_bind_source_mutation_to_version.sql',
  ),
  'utf8',
)
const repairMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260721234000_wp04_repair_release_invariants.sql'),
  'utf8',
)

describe('WP04 source mutation version fence', () => {
  it('requires every source mutation to bind a new immutable version', () => {
    expect(originalMigration).toContain(
      'new.current_version_id is not distinct from old.current_version_id',
    )
    expect(repairMigration).toContain('contract source mutation requires a new current version')
    expect(repairMigration).toContain("errcode = '23514'")
    expect(repairMigration).toContain('version.id = new.current_version_id')
    expect(repairMigration).toContain('version.contract_id = old.id')
  })

  it('does not erase valid equal text from a different source package', () => {
    expect(repairMigration).not.toContain('new.parsed_text := null')
    expect(repairMigration).not.toContain(
      'new.parsed_text is not distinct from old.parsed_text',
    )
  })

  it('uses the WP04 lease and only an optional runtime lookup for the later review workflow', () => {
    expect(repairMigration).toContain("status in ('preparing', 'queued', 'running')")
    expect(repairMigration).toContain(
      "to_regclass('public.contract_review_submission_batches')",
    )
    expect(repairMigration).toContain("execute 'select exists (")
    expect(repairMigration).toContain('drop trigger if exists trg_contract_source_active_review_lock')
    expect(repairMigration).toContain('create trigger trg_contract_source_active_review_lock')
    expect(repairMigration).toContain("new.status := 'PENDING'")
  })
})
