import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }) }))
vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn().mockResolvedValue('org-1'),
  listAccessibleUserIds: vi.fn().mockResolvedValue({ userIds: ['user-1'] }),
}))
vi.mock('@/lib/route-params', () => ({ resolveIdParam: vi.fn().mockResolvedValue('contract-1') }))
vi.mock('@/lib/observability', () => ({
  getRequestId: vi.fn().mockReturnValue('request-1'),
  logRouteStart: vi.fn(),
  logRouteDone: vi.fn(),
  logRouteFailure: vi.fn(),
}))
vi.mock('@/lib/export/pdf-annotator', () => ({ generateAnnotatedPdf: vi.fn() }))
vi.mock('@/lib/export/word-generator', () => ({ generateWordDocument: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}))

import { POST } from './route'
import { generateAnnotatedPdf } from '@/lib/export/pdf-annotator'
import { supabaseAdmin } from '@/lib/supabase'

function maybeSingleQuery(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

function orderedQuery(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

describe('POST source-annotated export', () => {
  const source = Buffer.from('%PDF-1.7\nsource bytes')
  const sourceHash = createHash('sha256').update(source).digest('hex')
  const sourceTextHash = createHash('sha256').update('').digest('hex')
  const contract = {
    id: 'contract-1',
    filename: 'source.pdf',
    storage_path: 'contract-1/source.pdf',
    created_by: 'user-1',
    contract_reviews: [],
  }
  const annotation = {
    id: 'annotation-1', start_offset: 0, end_offset: 0, selected_text: null,
    comment: '零风险 PDF 人工批注', category: 'issue', priority: 'normal', status: 'open',
    author_id: 'user-1', created_at: '2026-07-16T00:00:00.000Z',
    source_anchor: { kind: 'point', page: 1, point: { x: 0.5, y: 0.5 } },
    source_storage_path: contract.storage_path, source_hash: sourceHash, source_text_hash: sourceTextHash,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.storage.from).mockReturnValue({
      download: vi.fn().mockResolvedValue({ data: new Blob([source]), error: null }),
    } as never)
  })

  it('rejects export before any storage or generator work when browser source identity is missing', async () => {
    const response = await POST(new NextRequest('http://localhost/api/contracts/contract-1/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ export_mode: 'source_annotated' }),
    }), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('SOURCE_IDENTITY_REQUIRED')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(generateAnnotatedPdf).not.toHaveBeenCalled()
  })

  it('exports a manual PDF annotation without requiring a ReviewRun', async () => {
    const outputPath = path.join(os.tmpdir(), `export-test-${randomUUID()}.pdf`)
    fs.writeFileSync(outputPath, Buffer.from('annotated pdf'))
    vi.mocked(generateAnnotatedPdf).mockResolvedValue({ success: true, outputPath, anchored: 1, unlocated: [] })
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(maybeSingleQuery({ data: contract, error: null }) as never)
      .mockReturnValueOnce(orderedQuery({ data: [annotation], error: null }) as never)
      .mockReturnValueOnce(orderedQuery({ data: [], error: null }) as never)
      .mockReturnValueOnce(maybeSingleQuery({ data: { storage_path: contract.storage_path, source_hash: sourceHash, source_text_hash: sourceTextHash }, error: null }) as never)

    const response = await POST(new NextRequest('http://localhost/api/contracts/contract-1/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        export_mode: 'source_annotated',
        source_identity: { storage_path: contract.storage_path, source_hash: sourceHash, source_text_hash: sourceTextHash },
      }),
    }), { params: Promise.resolve({ id: 'contract-1' }) })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain(encodeURIComponent('source-ONES批注版.pdf'))
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('annotated pdf')
    expect(generateAnnotatedPdf).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      annotations: [annotation],
      decision_drafts: [],
    }))
    expect(fs.existsSync(outputPath)).toBe(false)
  })

  it('rejects legacy DOC before any storage or generator work', async () => {
    const legacyDoc = {
      ...contract,
      filename: 'legacy.doc',
      storage_path: 'contract-1/legacy.doc',
    }
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(maybeSingleQuery({ data: legacyDoc, error: null }) as never)

    const response = await POST(new NextRequest('http://localhost/api/contracts/contract-1/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        export_mode: 'source_annotated',
        source_identity: {
          storage_path: legacyDoc.storage_path,
          source_hash: 'a'.repeat(64),
          source_text_hash: sourceTextHash,
        },
      }),
    }), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.code).toBe('LEGACY_DOC_REQUIRES_DOCX')
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
    expect(generateAnnotatedPdf).not.toHaveBeenCalled()
  })

  it('stops before generation when downloaded source bytes do not match the page-map hash', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(maybeSingleQuery({ data: contract, error: null }) as never)
      .mockReturnValueOnce(orderedQuery({ data: [annotation], error: null }) as never)
      .mockReturnValueOnce(orderedQuery({ data: [], error: null }) as never)
      .mockReturnValueOnce(maybeSingleQuery({ data: { storage_path: contract.storage_path, source_hash: 'b'.repeat(64), source_text_hash: sourceTextHash }, error: null }) as never)

    const response = await POST(new NextRequest('http://localhost/api/contracts/contract-1/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        export_mode: 'source_annotated',
        source_identity: { storage_path: contract.storage_path, source_hash: sourceHash, source_text_hash: sourceTextHash },
      }),
    }), { params: Promise.resolve({ id: 'contract-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('SOURCE_IDENTITY_CONFLICT')
    expect(generateAnnotatedPdf).not.toHaveBeenCalled()
  })
})
