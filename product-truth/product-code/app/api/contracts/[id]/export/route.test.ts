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

vi.mock('@/lib/contracts/model-policy', () => ({
  recordModelInvocation: vi.fn(),
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
import { recordModelInvocation } from '@/lib/contracts/model-policy'

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

function makeModelInvocationResult(result: unknown) {
  const chain: any = {
    select: vi.fn(() => chain),
    in: vi.fn().mockResolvedValue(result),
  }
  return chain
}

function makeUpdateResult(result: { error: unknown }) {
  const chain: any = {
    ...result,
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
  }
  return chain
}

function installSupabaseExportMocks(options: {
  versions?: Array<{
    id: string
    version_number: number
    source: string
    storage_path?: string | null
    parent_version_id?: string | null
    review_id?: string | null
    created_at?: string | null
  }>
  downloadBytes?: BlobPart
  modelInvocations?: Array<{
    id: string
    phase: string
    provider: string
    model: string
    status: string
    degraded: boolean
    fallback_reason?: string | null
    error_message?: string | null
    response_meta?: Record<string, unknown>
  }>
} = {}) {
  const contract = {
    id: 'contract-1',
    filename: 'source.docx',
    storage_path: 'contract-1/source.docx',
    parsed_text: '付款周期为 120 天，质保期为 24 个月。',
    contract_reviews: [{
      id: 'review-1',
      created_at: '2026-07-02T01:00:00.000Z',
      model_invocation_ids: ['invocation-semantic'],
      results: { summary: '审核完成', risks: [] },
    }],
  }
  const modelInvocations = options.modelInvocations || [{
    id: 'invocation-semantic',
    phase: 'semantic_review',
    provider: 'AI_LEVEL_1',
    model: 'gpt-oss-20b',
    status: 'completed',
    degraded: false,
    response_meta: {
      provider_kind: 'openai_compatible',
      transport: 'openai_compatible_http',
      validation_warnings: [],
      dropped_risk_count: 0,
      usable_risk_count: 1,
    },
  }]

  const queues: Record<string, any[]> = {
    contracts: [makeSingleResult({ data: contract, error: null })],
    contract_clauses: [makeArrayResult({ data: [], error: null })],
    contract_annotations: [makeArrayResult({ data: [], error: null })],
    contract_risk_cards: [makeArrayResult({ data: [], error: null })],
    model_invocations: [makeModelInvocationResult({ data: modelInvocations, error: null })],
    contract_versions: [
      makeArrayResult({
        data: options.versions || [{ id: 'version-1', version_number: 1, source: 'original' }],
        error: null,
      }),
      makeInsertResult({ error: null }),
    ],
    report_versions: [makeUpdateResult({ error: null })],
    contract_reviews: [makeUpdateResult({ error: null })],
  }

  ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
    const query = queues[table]?.shift()
    if (!query) throw new Error(`unexpected table ${table}`)
    return query
  })

  const storage = {
    download: vi.fn().mockResolvedValue({
      data: new Blob([options.downloadBytes || 'source docx bytes']),
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
    ;(recordModelInvocation as any).mockReset()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(listAccessibleUserIds as any).mockResolvedValue({ userIds: ['user-1'] })
    ;(resolveIdParam as any).mockResolvedValue('contract-1')
    ;(recordModelInvocation as any)
      .mockResolvedValueOnce({ id: 'invocation-comment-patch' })
      .mockResolvedValueOnce({ id: 'invocation-report-summary' })
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
      expect.stringContaining('reviewed/contract-1/review-review-1/source-version-1-'),
      expect.any(Buffer),
      expect.objectContaining({
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    )
    expect(recordModelInvocation).toHaveBeenCalledTimes(2)
    expect(recordModelInvocation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orgId: 'org-1',
      contractId: 'contract-1',
      reviewId: 'review-1',
      provider: 'rule-engine',
      model: 'source-comment-template',
      phase: 'comment_patch_draft',
      status: 'degraded',
      degraded: true,
      fallbackReason: 'comment_patch_rule_template_no_external_model',
      responseMeta: expect.objectContaining({
        provider_kind: 'builtin',
        transport: 'builtin_rule_engine',
        source_comment_mode: 'source_comments',
      }),
    }))
    expect(recordModelInvocation).toHaveBeenNthCalledWith(2, expect.objectContaining({
      orgId: 'org-1',
      contractId: 'contract-1',
      reviewId: 'review-1',
      provider: 'rule-engine',
      model: 'review-summary-existing',
      phase: 'report_summary',
      status: 'degraded',
      degraded: true,
      fallbackReason: 'report_summary_reused_review_result_no_external_model',
    }))
    expect(supabaseAdmin.from).toHaveBeenCalledWith('contract_reviews')
  })

  it('批注意图跨段或过短时返回导出门禁错误，不进入 Word 生成器', async () => {
    const contract = {
      id: 'contract-1',
      filename: 'source.docx',
      storage_path: 'contract-1/source.docx',
      parsed_text: '保密义务\n3 年。',
      contract_reviews: [{
        id: 'review-1',
        created_at: '2026-07-02T01:00:00.000Z',
        results: { summary: '审核完成', risks: [{ level: 'yellow', title: '保密期', description: '偏离', suggestion: '谈判' }] },
      }],
    }
    const queues: Record<string, any[]> = {
      contracts: [makeSingleResult({ data: contract, error: null })],
      contract_clauses: [makeArrayResult({ data: [], error: null })],
      contract_annotations: [makeArrayResult({
        data: [{
          id: 'annotation-1',
          start_offset: 0,
          end_offset: 6,
          selected_text: '保密义务\n3',
          comment: '【需谈判风险】保密期\n证据原文：保密义务\n3',
          category: 'risk_finding',
          priority: 'high',
          status: 'open',
          author_id: 'user-1',
          created_at: '2026-07-02T01:00:00.000Z',
        }],
        error: null,
      })],
      contract_risk_cards: [makeArrayResult({ data: [], error: null })],
    }
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      const query = queues[table]?.shift()
      if (!query) throw new Error(`unexpected table ${table}`)
      return query
    })

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('EXPORT_GATE_BLOCKED')
    expect(body.error).toContain('疑似跨段')
    expect(generateWordDocument).not.toHaveBeenCalled()
    expect(recordModelInvocation).not.toHaveBeenCalled()
  })

  it('模型调用未通过质量门禁时仍可导出已定位批注版，但审计记录模型门禁警告', async () => {
    installSupabaseExportMocks({
      modelInvocations: [{
        id: 'invocation-semantic',
        phase: 'semantic_review',
        provider: 'rule-engine',
        model: 'fallback',
        status: 'completed',
        degraded: true,
        fallback_reason: 'semantic_model_unavailable',
        response_meta: {
          provider_kind: 'builtin',
          transport: 'builtin_rule_engine',
          validation_warnings: ['fallback_result'],
          dropped_risk_count: 1,
        },
      }],
    })
    const outputPath = path.join(os.tmpdir(), `ones-degraded-source-comments-${Date.now()}.docx`)
    fs.writeFileSync(outputPath, Buffer.from([9, 8, 7]))
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
    expect(body).toEqual(Buffer.from([9, 8, 7]))
    expect(generateWordDocument).toHaveBeenCalled()
    expect(recordModelInvocation).toHaveBeenCalledTimes(2)
    expect(recordModelInvocation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      responseMeta: expect.objectContaining({
        model_gate_warnings: expect.arrayContaining([
          expect.stringContaining('semantic_review 已降级'),
          expect.stringContaining('OpenAI-compatible HTTP'),
        ]),
      }),
    }))
  })

  it('同一 ReviewRun 已有源文件批注产物时直接复用，不重复生成版本噪音', async () => {
    const { storage } = installSupabaseExportMocks({
      versions: [
        {
          id: 'version-2',
          version_number: 2,
          source: 'review_revision',
          storage_path: 'reviewed/contract-1/review-review-1/source-version-1.docx',
          parent_version_id: 'version-1',
          review_id: 'review-1',
          created_at: '2026-07-02T02:00:00.000Z',
        },
        {
          id: 'version-1',
          version_number: 1,
          source: 'original',
          storage_path: 'contract-1/source.docx',
          created_at: '2026-07-02T01:00:00.000Z',
        },
      ],
      downloadBytes: 'existing annotated bytes',
    })

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = Buffer.from(await res.arrayBuffer())

    expect(res.status).toBe(200)
    expect(body).toEqual(Buffer.from('existing annotated bytes'))
    expect(res.headers.get('x-export-reused')).toBe('true')
    expect(res.headers.get('x-contract-version-number')).toBe('2')
    expect(generateWordDocument).not.toHaveBeenCalled()
    expect(recordModelInvocation).not.toHaveBeenCalled()
    expect(storage.upload).not.toHaveBeenCalled()
  })
})
