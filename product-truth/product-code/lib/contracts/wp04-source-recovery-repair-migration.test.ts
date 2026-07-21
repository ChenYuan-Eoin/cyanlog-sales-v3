import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260721240000_wp04_source_recovery_repair.sql'),
  'utf8',
)
const artifactBindingMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260721230000_wp04_review_artifact_binding.sql'),
  'utf8',
)
const canary = readFileSync(
  join(process.cwd(), 'lib/contracts/canaries/wp04-source-recovery-repair-canary.sql'),
  'utf8',
)

describe('WP04 source recovery forward repair', () => {
  it('deletes only derived evidence whose complete identity disagrees with ContractVersion', () => {
    const reconcileStart = migration.indexOf(
      'create or replace function private.wp04_reconcile_invalid_source_evidence()',
    )
    const reconcileEnd = migration.indexOf(
      'revoke all on function private.wp04_reconcile_invalid_source_evidence()',
      reconcileStart,
    )
    const reconcile = migration.slice(reconcileStart, reconcileEnd)

    expect(reconcile).toContain('delete from public.contract_source_page_map_evidence as evidence')
    for (const predicate of [
      'evidence.contract_id is distinct from version.contract_id',
      'evidence.storage_path is distinct from version.storage_path',
      'evidence.source_hash is distinct from version.file_sha256',
      'evidence.source_text_hash is distinct from version.text_sha256',
    ]) {
      expect(reconcile).toContain(predicate)
    }
    expect(reconcile).not.toMatch(/delete\s+from\s+public\.contract_source_page_maps/i)
    expect(reconcile).not.toMatch(/delete\s+from\s+public\.contract_versions/i)
    expect(reconcile).not.toMatch(/delete\s+from\s+public\.contract_reviews/i)
    expect(reconcile).not.toMatch(/delete\s+from\s+public\.contracts/i)
  })

  it('validates full version identity before capturing immutable page-map evidence', () => {
    const captureStart = migration.indexOf(
      'create or replace function public.capture_contract_source_page_map_evidence()',
    )
    const captureEnd = migration.indexOf(
      'revoke all on function public.capture_contract_source_page_map_evidence()',
      captureStart,
    )
    const capture = migration.slice(captureStart, captureEnd)

    expect(capture).toContain('where version.id = new.contract_version_id')
    expect(capture).toContain('source_version.contract_id is distinct from new.contract_id')
    expect(capture).toContain('source_version.storage_path is distinct from new.storage_path')
    expect(capture).toContain('source_version.file_sha256 is distinct from new.source_hash')
    expect(capture).toContain('source_version.text_sha256 is distinct from new.source_text_hash')
    expect(capture).toContain("source_version.ingest_status is distinct from 'SOURCE_READY'")
    expect(capture.indexOf('select version.*')).toBeLessThan(
      capture.indexOf('insert into public.contract_source_page_map_evidence'),
    )
  })

  it('keeps invalidated review artifacts auditable but excludes them from bound reads', () => {
    expect(migration).toContain("binding_state in ('bound', 'source_invalidated')")
    expect(migration).toContain("set binding_state = 'source_invalidated'")
    expect(migration).toContain("then 'source_recovery_invalidated'")
    expect(migration).toContain("set status = 'FAILED'")
    expect(migration).toContain("set status = 'failed'")
    expect(migration).toContain('invalidated_start_request_id = coalesce(')
    expect(migration).toContain('start_request_id = null')
    expect(migration).toContain("last_error = 'SOURCE_IDENTITY_INVALIDATED'")
    expect(migration).toContain(
      'report trigger ASK must share the artifact binding and source identity',
    )
  })

  it('recovers only an exact current immutable source and does not rewrite source facts', () => {
    const wrapperStart = migration.indexOf(
      'create or replace function public.finalize_contract_source_version(',
    )
    const wrapperEnd = migration.indexOf(
      'revoke all on function public.finalize_contract_source_version(',
      wrapperStart,
    )
    const wrapper = migration.slice(wrapperStart, wrapperEnd)

    expect(migration).toContain('rename to wp04_finalize_contract_source_version_base')
    expect(wrapper).toContain("existing_version.ingest_status is distinct from 'FAILED'")
    expect(wrapper).toContain(
      "existing_version.ingest_error is distinct from 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE'",
    )
    expect(wrapper).toContain('current_contract.current_version_id is distinct from existing_version.id')
    expect(wrapper).toContain('existing_version.file_sha256 is distinct from p_file_sha256')
    expect(wrapper).toContain('existing_version.text_sha256 is distinct from p_text_sha256')
    expect(wrapper).toContain('existing_version.parsed_text is distinct from p_parsed_text')
    expect(wrapper).toContain('failed source recovery cannot rewrite immutable source facts')
    expect(wrapper).toContain("pg_catalog.to_regclass('public.contract_review_submission_batches')")
    expect(wrapper).toContain('execute $sql$')
    expect(wrapper).not.toMatch(
      /or exists \(\s*select 1\s*from public\.contract_review_submission_batches/i,
    )
    expect(wrapper).toContain("set ingest_status = 'SOURCE_READY'")
    expect(wrapper).toContain('insert into public.contract_source_page_maps')
    expect(wrapper).not.toMatch(/set\s+(storage_path|file_sha256|text_sha256|parsed_text)\s*=/i)

    const discoveryRead = wrapper.indexOf('where version.upload_id = p_upload_id;')
    const contractLock = wrapper.indexOf('for update;', wrapper.indexOf('from public.contracts as contract'))
    const versionLock = wrapper.indexOf('for update;', contractLock + 1)
    expect(discoveryRead).toBeGreaterThan(-1)
    expect(contractLock).toBeGreaterThan(discoveryRead)
    expect(versionLock).toBeGreaterThan(contractLock)
  })

  it('keeps invalidated rows outside all live uniqueness/current indexes and updates ASK before report', () => {
    for (const indexName of [
      'idx_ask_items_review_code_bound',
      'idx_ask_items_contract_code_legacy',
      'idx_report_versions_review_version_bound',
      'idx_report_versions_review_current_bound',
      'idx_report_versions_contract_version_legacy',
      'idx_report_versions_contract_current_legacy',
    ]) {
      const start = artifactBindingMigration.indexOf(`create unique index if not exists ${indexName}`)
      const end = artifactBindingMigration.indexOf(';', start)
      const definition = artifactBindingMigration.slice(start, end)
      expect(start).toBeGreaterThan(-1)
      expect(definition).not.toContain('source_invalidated')
    }

    const reconcileStart = migration.indexOf(
      'create or replace function private.wp04_reconcile_invalid_source_evidence()',
    )
    const reconcileEnd = migration.indexOf(
      'revoke all on function private.wp04_reconcile_invalid_source_evidence()',
      reconcileStart,
    )
    const reconcile = migration.slice(reconcileStart, reconcileEnd)
    expect(reconcile.indexOf('update public.ask_items as ask')).toBeLessThan(
      reconcile.indexOf('update public.report_versions as report'),
    )
  })

  it('validates current SOURCE_READY, hash and page-map truth before existing-review recovery', () => {
    const start = migration.indexOf(
      'create or replace function public.start_initial_contract_review(',
    )
    const end = migration.indexOf(
      'revoke all on function public.start_initial_contract_review(',
      start,
    )
    const body = migration.slice(start, end)
    const truthCheck = body.indexOf('private.wp04_contract_source_version_ready_truth')
    const pageMapCheck = body.indexOf('from public.contract_source_page_maps as page_map')
    const existingReviewLookup = body.indexOf('from public.contract_reviews as review')

    expect(truthCheck).toBeGreaterThan(-1)
    expect(pageMapCheck).toBeGreaterThan(truthCheck)
    expect(existingReviewLookup).toBeGreaterThan(pageMapCheck)
    expect(body).toContain('existing_review.source_hash is distinct from current_version.file_sha256')
    expect(body).toContain('existing initial review source identity is stale')
  })

  it('ships a self-contained rollback-only Preview behavior canary', () => {
    expect(canary).toContain('private.wp04_reconcile_invalid_source_evidence()')
    expect(canary).toContain('public.finalize_contract_source_version(')
    expect(canary).toContain('public.start_initial_contract_review(')
    expect(canary).toContain('source_recovery_invalidated')
    expect(canary).toContain('source_invalidated')
    expect(canary).toContain('same source recovery did not become truthful SOURCE_READY')
    expect(canary).toContain('valid historical evidence was not preserved')
    expect(canary).toContain("'valid_historical_evidence_preserved', true")
    expect(canary).toContain('existing-review replay created duplicate work')
    expect(canary).toContain("'known_mismatch_class', 'file_and_text_hash'")
    expect(canary).toContain("'status', 'passed'")
    expect(canary.trimEnd()).toMatch(/rollback;$/)
  })
})
