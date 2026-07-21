import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260721194500_wp04_contract_source_ingestion.sql'),
  'utf8',
)

describe('WP04 source ingestion migration contract', () => {
  it('uses ContractVersion as the upload aggregate with stable identities', () => {
    expect(migration).toContain('add column if not exists upload_id uuid')
    expect(migration).toContain('add column if not exists file_sha256 text')
    expect(migration).toContain('add column if not exists text_sha256 text')
    expect(migration).toContain('add column if not exists ingest_status text')
    expect(migration).toContain('uq_contract_versions_upload_id')
    expect(migration).toContain('uq_contract_versions_contract_storage_path')
    expect(migration).toContain('add column if not exists current_version_id uuid')
    expect(migration).toContain('drop index if exists public.idx_contract_analysis_jobs_start_request')
    expect(migration).toContain('create unique index if not exists uq_contract_analysis_jobs_start_request')
  })

  it('finalizes one storage object, version and current source identity atomically', () => {
    const start = migration.indexOf('create or replace function public.finalize_contract_source_version')
    const end = migration.indexOf('revoke all on function public.finalize_contract_source_version', start)
    const body = migration.slice(start, end)

    expect(body).toContain('pg_advisory_xact_lock')
    expect(body).toContain('where version.upload_id = p_upload_id')
    expect(body).toContain('current_contract.current_version_id is distinct from existing_version.id')
    expect(body).toContain("raise exception 'contract source changed during upload'")
    expect(body).toContain('insert into public.contract_versions')
    expect(body).toContain('update public.contracts')
    expect(body).toContain('insert into public.contract_source_page_maps')
    expect(body).toContain("p_ingest_status = 'AWAITING_OCR'")
    expect(body).toContain("coalesce(pg_catalog.btrim(p_ingest_error), '') = ''")
    expect(body).toContain("'source', 'awaiting-ocr'")
    expect(body).toContain('must not publish a reviewable identity')
  })

  it('rejects page maps that do not describe the current source version', () => {
    const start = migration.indexOf('create or replace function public.enforce_current_contract_page_map_source')
    const end = migration.indexOf('revoke all on function public.enforce_current_contract_page_map_source', start)
    const body = migration.slice(start, end)

    expect(body).toContain('source_version.id = contract.current_version_id')
    expect(body).toContain('new.contract_version_id is distinct from current_version_id')
    expect(body).toContain('new.storage_path is distinct from current_storage_path')
    expect(body).toContain('new.source_hash is distinct from current_file_hash')
    expect(body).toContain('new.source_text_hash is distinct from projected_text_hash')
    expect(migration).toContain('trg_contract_page_map_current_source')
  })

  it('creates or recovers exactly one initial review per source version', () => {
    expect(migration).toContain("review_trigger in ('direct', 'decision_batch', 'initial_upload')")
    expect(migration).toContain('uq_contract_reviews_initial_source_version')
    expect(migration).toContain('create or replace function public.start_initial_contract_review')
    expect(migration).toContain("review.review_trigger = 'initial_upload'")
    expect(migration).toContain("existing_job.status = 'failed'")
    expect(migration).toContain('stable_start_request_id := coalesce(current_version.upload_id, current_version.id)')
    expect(migration).toContain('create or replace function public.claim_contract_analysis_job_by_id')
    expect(migration).toContain("and job.status = 'queued'")
  })

  it('keeps privileged ingestion functions service-role only', () => {
    for (const functionName of [
      'finalize_contract_source_version',
      'start_initial_contract_review',
      'claim_contract_analysis_job_by_id',
    ]) {
      expect(migration).toMatch(new RegExp(
        `revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated;`,
      ))
      expect(migration).toMatch(new RegExp(
        `grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role;`,
      ))
    }
  })
})
