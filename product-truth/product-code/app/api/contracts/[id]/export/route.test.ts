/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
  listAccessibleUserIds: vi.fn(),
}))

vi.mock('@/lib/route-params', () => ({
  resolveIdParam: vi.fn(),
}))

vi.mock('@/lib/observability', () => ({
  getRequestId: vi.fn(() => 'req-1'),
  logRouteDone: vi.fn(),
  logRouteFailure: vi.fn(),
  logRouteStart: vi.fn(),
}))

vi.mock('@/lib/error-log', () => ({
  logError: vi.fn(),
}))

vi.mock('@/lib/export/word-generator', () => ({
  generateWordDocument: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    storage: {
      from: vi.fn(),
    },
  },
}))

import { POST } from './route'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { resolveIdParam } from '@/lib/route-params'
import { generateWordDocument } from '@/lib/export/word-generator'
import { supabaseAdmin } from '@/lib/supabase'

const tempFiles: string[] = []

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }
})

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/contracts/contract-1/export', {
    method: 'POST',
    headers: { authorization: 'Bearer token-1' },
  })
}

function makeSingleResult(result: unknown) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  return chain
}

function makeArrayResult(result: unknown) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn().mockResolvedValue(result),
  }
  return chain
}

function makeInsertResult(result: unknown) {
  return {
    insert: vi.fn().mockResolvedValue(result),
  }
}

function makeUpdateResult(result: { error: unknown }) {
  const chain: any = {
    ...result,
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
  }
  return chain
}

function installSupabaseExportMocks() {
  const contract = {
    id: 'contract-1',
    filename: 'source.docx',
    storage_path: 'contract-1/source.docx',
    parsed_text: '付款周期为 120 天，质保期为 24 个月。',
    contract_reviews: [{
      id: 'review-1',
      created_at: '2026-07-02T01:00:00.000Z',
      results: { summary: '审核完成', risks: [] },
    }],
  }

  const queues: Record<string, any[]> = {
    contracts: [makeSingleResult({ data: contract, error: null })],
    contract_clauses: [makeArrayResult({ data: [], error: null })],
    contract_annotations: [makeArrayResult({ data: [], error: null })],
    contract_risk_cards: [makeArrayResult({ data: [], error: null })],
    contract_versions: [
      makeArrayResult({
        data: [{ id: 'version-1', version_number: 1, source: 'original' }],
        error: null,
      }),
      makeInsertResult({ error: null }),
    ],
    report_versions: [makeUpdateResult({ error: null })],
  }

  ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
    const query = queues[table]?.shift()
    if (!query) throw new Error(`unexpected table ${table}`)
    return query
  })

  const storage = {
    download: vi.fn().mockResolvedValue({
      data: new Blob(['source docx bytes']),
      error: null,
    }),
    upload: vi.fn().mockResolvedValue({ error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
  }
  ;(supabaseAdmin.storage.from as any).mockReturnValue(storage)

  return { storage, queues }
}

describe('POST /api/contracts/[id]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(listAccessibleUserIds as any).mockResolvedValue({ userIds: ['user-1'] })
    ;(resolveIdParam as any).mockResolvedValue('contract-1')
  })

  it('拒绝把非源文件批注版当作导出成功', async () => {
    installSupabaseExportMocks()
    ;(generateWordDocument as any).mockResolvedValue({
      success: true,
      outputPath: '/tmp/ones-report-only.docx',
      mode: 'report',
    })

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.code).toBe('EXPORT_NOT_SOURCE_COMMENTS')
    expect(body.error).toBe('未生成源文件批注版，请检查源文件格式')
  })

  it('源文件批注版导出成功时登记 review_revision 版本并返回性能分段', async () => {
    const { storage } = installSupabaseExportMocks()
    const outputPath = path.join(os.tmpdir(), `ones-source-comments-${Date.now()}.docx`)
    fs.writeFileSync(outputPath, Buffer.from([1, 2, 3, 4]))
    tempFiles.push(outputPath)
    ;(generateWordDocument as any).mockResolvedValue({
      success: true,
      outputPath,
      mode: 'source_comments',
    })

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = Buffer.from(await res.arrayBuffer())

    expect(res.status).toBe(200)
    expect(body).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(res.headers.get('x-export-timing')).toContain('storage_download')
    expect(res.headers.get('x-export-timing')).toContain('docx_generate')
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringContaining('reviewed/contract-1/'),
      expect.any(Buffer),
      expect.objectContaining({
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    )
  })
})
