// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260721194500_wp04_contract_source_ingestion.sql',
), 'utf8')

describe('WP04 contract source Storage migration', () => {
  it('keeps the final bucket private, bounded to 50MB and document-only MIME types', () => {
    expect(migration).toContain("'contracts',\n  'contracts',\n  false,\n  52428800")
    expect(migration).toContain("'application/pdf'")
    expect(migration).toContain("'application/msword'")
    expect(migration).toContain("'application/vnd.openxmlformats-officedocument.wordprocessingml.document'")
    expect(migration).toContain("'application/vnd.ms-word.document.macroEnabled.12'")
    expect(migration).not.toContain("'image/jpeg'")
    expect(migration).not.toContain("'image/png'")
  })

  it('removes bucket-wide authenticated CRUD instead of preserving cross-organization access', () => {
    for (const operation of ['read', 'insert', 'update', 'delete']) {
      expect(migration).toContain(
        `drop policy if exists "contract buckets ${operation}" on storage.objects;`,
      )
    }
    expect(migration).not.toMatch(/create policy "contract buckets (read|insert|update|delete)"/i)
    expect(migration).toContain('from public.user_organizations as membership')
    expect(migration).toContain('membership.user_id = p_uploaded_by')
    expect(migration).toContain('membership.org_id = p_org_id')
  })

  it('binds the RPC upload UUID and object path to contract plus final SHA', () => {
    expect(migration).toContain("'contract-source:' || pg_catalog.lower(p_contract_id::text)")
    expect(migration).toContain('expected_upload_id')
    expect(migration).toContain("p_contract_id::text || '/' || expected_upload_id::text || '/source'")
    expect(migration).toContain("raise exception 'upload id is not bound to contract and file hash'")
  })

  it('fails closed when service-side finalized metadata is NULL', () => {
    expect(migration).toContain('or p_file_size is null')
    expect(migration).toContain("coalesce(p_mime_type, '') not in")
    expect(migration).toContain("coalesce(p_ingest_status, '') not in")
    expect(migration).toContain("p_mime_type is distinct from 'application/pdf'")
    expect(migration).toContain("p_mime_type is distinct from 'application/msword'")
    expect(migration).toContain("p_ingest_error is distinct from 'PDF_TEXT_UNAVAILABLE'")
    expect(migration).toContain("p_ingest_error is distinct from 'LEGACY_DOC_REQUIRES_CONVERSION'")
  })

  it('preserves legacy DOC in a distinct non-reviewable conversion state', () => {
    expect(migration).toContain("'AWAITING_CONVERSION'")
    expect(migration).toContain("'LEGACY_DOC_REQUIRES_CONVERSION'")
    expect(migration).toContain("if current_version.ingest_status <> 'SOURCE_READY'")
  })
})
