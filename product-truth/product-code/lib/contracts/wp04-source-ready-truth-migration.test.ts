import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260721235000_wp04_source_ready_truth.sql'),
  'utf8',
)
const canary = readFileSync(
  join(process.cwd(), 'lib/contracts/canaries/wp04-source-ready-truth-canary.sql'),
  'utf8',
)

describe('WP04 SOURCE_READY truth forward repair', () => {
  it('repairs the three legacy false-ready paths without deleting source data', () => {
    expect(migration).toContain("version.source = 'review_revision'")
    expect(migration).toContain("then 'FILE_STORED'")
    expect(migration).toContain("else 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE'")
    expect(migration).toContain("version.storage_path = contract.storage_path")
    expect(migration).toContain('candidate_count = 1')
    expect(migration).toContain('exact_source.candidate_count = 1')
    expect(migration).toContain('version.file_size is not distinct from contract.size::bigint')
    expect(migration).toContain('version.mime_type is not distinct from contract.mime_type')
    expect(migration).toContain('version.parsed_text is not distinct from contract.parsed_text')
    expect(migration).toContain("job.status in ('preparing', 'queued', 'running')")
    expect(migration).toContain('set current_version_id = candidate.candidate_id')
    expect(migration).not.toContain(
      'drop trigger if exists trg_contract_source_active_review_lock',
    )
    expect(migration).not.toMatch(/delete\s+from\s+public\.contract_versions/i)
    expect(migration).not.toMatch(/delete\s+from\s+public\.contracts/i)
    expect(migration).not.toMatch(/delete\s+from\s+public\.contract_source_page_maps/i)
  })

  it('requires deterministic upload, storage, parsed-text and hash identity', () => {
    expect(migration).toContain('private.wp04_expected_source_upload_id')
    expect(migration).toContain("'contract-source:' || pg_catalog.lower(p_contract_id::text)")
    expect(migration).toContain("version.source in ('original', 'manual_revision')")
    expect(migration).toContain("version.file_sha256 ~ '^[0-9a-f]{64}$'")
    expect(migration).toContain("version.text_sha256 ~ '^[0-9a-f]{64}$'")
    expect(migration).toContain("nullif(pg_catalog.btrim(version.parsed_text), '') is not null")
    expect(migration).toContain("extensions.digest")
    expect(migration).toContain('contract_versions_source_ready_intrinsic_check')
  })

  it('preserves immutable version-bound page-map evidence and validates current projection', () => {
    expect(migration).toContain('create table if not exists public.contract_source_page_map_evidence')
    expect(migration).toContain(
      'contract_version_id uuid primary key\n    references public.contract_versions(id)',
    )
    expect(migration).toContain('capture_contract_source_page_map_evidence')
    expect(migration).toContain('version-bound source page map evidence is immutable')
    expect(migration).toContain('pg_catalog.jsonb_array_length(evidence.page_map) = evidence.page_count')
    expect(migration).toContain("mapped_page.item ->> 'page'")
    expect(migration).toContain('current_page_map.contract_version_id = version.id')
    expect(migration).toContain('current_page_map.source_text_hash = evidence.source_text_hash')
  })

  it('enforces cross-table truth at transaction completion', () => {
    expect(migration).toContain('create or replace function public.enforce_contract_source_ready_truth()')
    for (const trigger of [
      'trg_contract_version_source_ready_truth',
      'trg_contract_current_source_ready_truth',
      'trg_contract_page_map_source_ready_truth',
      'trg_contract_page_map_evidence_ready_truth',
    ]) {
      expect(migration).toContain(`create constraint trigger ${trigger}`)
    }
    expect(migration.match(/deferrable initially deferred/g)).toHaveLength(4)
    expect(migration).toContain(
      'SOURCE_READY requires complete immutable source and page-map identity',
    )
  })

  it('keeps the evidence table server-only', () => {
    expect(migration).toContain(
      'alter table public.contract_source_page_map_evidence enable row level security',
    )
    expect(migration).toContain(
      'revoke all on table public.contract_source_page_map_evidence\n  from public, anon, authenticated, service_role',
    )
    expect(migration).toContain(
      'grant select on table public.contract_source_page_map_evidence\n  to service_role',
    )
  })

  it('tracks a rollback-only Preview canary for valid, invalid and historical paths', () => {
    expect(canary).toContain('private.wp04_expected_source_upload_id')
    expect(canary).toContain('private.wp04_contract_source_version_ready_truth')
    expect(canary).toContain('incomplete SOURCE_READY unexpectedly committed')
    expect(canary).toContain('historical version lost immutable page-map evidence')
    expect(canary).toContain("'status', 'passed'")
    expect(canary.trimEnd()).toMatch(/rollback;$/)
  })
})
