/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getDefaultOrgId: vi.fn(),
  parseDocument: vi.fn(),
  isDocumentParsePlaceholder: vi.fn(),
  extractTenderInfo: vi.fn(),
  extractTenderWithAIPlan: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/scoped-access', () => ({ getDefaultOrgId: mocks.getDefaultOrgId }))
vi.mock('@/lib/ocr/parser', () => ({
  parseDocument: mocks.parseDocument,
  isDocumentParsePlaceholder: mocks.isDocumentParsePlaceholder,
}))
vi.mock('@/lib/ocr/tender-parser', () => ({ extractTenderInfo: mocks.extractTenderInfo }))
vi.mock('@/lib/ai/tender-extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/tender-extract')>()
  return { ...actual, extractTenderWithAIPlan: mocks.extractTenderWithAIPlan }
})
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { AIExecutionError } from '@/lib/ai/runtime-executor'
import { TenderAIOutputError } from '@/lib/ai/tender-extract'
import { POST } from './route'

function request(file: File | null): any {
  return {
    formData: async () => ({ get: (name: string) => name === 'file' ? file : null }),
    headers: new Headers(),
    method: 'POST',
  }
}

function file(name = 'tender.pdf', type = 'application/pdf') {
  return new File(['招标文件'], name, { type })
}

function aiResult() {
  const runtime = {
    source: 'published_ai_runtime',
    provider: 'provider-cloud',
    model: 'model-cloud',
    transport: 'openai_compatible_http',
    chunk_count: 2,
    selected_chunk_count: 2,
    analyzed_chunk_count: 2,
    text_length: 1200,
    selected_text_length: 1300,
    analyzed_text_length: 1300,
    coverage_ratio: 1,
    chunk_coverage_ratio: 1,
    character_coverage_ratio: 1,
    business_signal_count: 5,
    business_signal_domains: 3,
    processing_ms: 800,
    concurrency: 2,
    degraded: false,
    attempt_errors: [],
    plan_snapshot_hash: 'a'.repeat(64),
    plan_snapshot_ids: ['snapshot-1'],
    model_invocation_id: 'invocation-1',
    model_invocation_ids: ['invocation-1', 'invocation-2'],
    input_tokens: 100,
    output_tokens: 60,
    total_tokens: 160,
  }
  return {
    keyInfo: {
      tenderNo: 'ZB-001',
      tenderName: '测试项目',
      confidence: 95,
      scores: [{ item: '技术方案', weight: 30, maxScore: 30 }],
      technicalRequirements: ['支持 10000 并发'],
      commercialTerms: ['验收后 30 日付款'],
      timeline: [{ event: '投标截止', date: '2026-08-01' }],
      aiRuntime: runtime,
    },
    runtime,
  }
}

function installInsert(error: unknown = null) {
  const single = vi.fn(async () => ({ data: error ? null : { id: 'ocr-1' }, error }))
  const select = vi.fn(() => ({ single }))
  const insert = vi.fn(() => ({ select }))
  mocks.from.mockImplementation((table: string) => {
    if (table !== 'ocr_results') throw new Error(`unexpected table ${table}`)
    return { insert }
  })
  return { insert }
}

describe('POST /api/tenders/ocr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.VERCEL
    delete process.env.VERCEL_URL
    delete process.env.VERCEL_REGION
    mocks.requireAuth.mockResolvedValue({ id: 'user-1' })
    mocks.getDefaultOrgId.mockResolvedValue('org-1')
    mocks.parseDocument.mockResolvedValue('招标编号：ZB-001\n项目名称：测试项目')
    mocks.isDocumentParsePlaceholder.mockReturnValue(false)
    mocks.extractTenderInfo.mockReturnValue({
      confidence: 30,
      scores: [],
      technicalRequirements: [],
      commercialTerms: [],
      timeline: [],
    })
    mocks.extractTenderWithAIPlan.mockResolvedValue(aiResult())
  })

  it('rejects missing and unreadable files before AI execution', async () => {
    const missing = await POST(request(null))
    expect(missing.status).toBe(400)
    expect(mocks.extractTenderWithAIPlan).not.toHaveBeenCalled()

    mocks.isDocumentParsePlaceholder.mockReturnValueOnce(true)
    mocks.parseDocument.mockResolvedValueOnce('[PDF未能提取可复制文本，可能是扫描件，需要接入云端视觉 OCR]')
    const unreadable = await POST(request(file()))
    expect(unreadable.status).toBe(422)
    expect((await unreadable.json()).error.code).toBe('VISUAL_OCR_REQUIRED')
    expect(mocks.extractTenderWithAIPlan).not.toHaveBeenCalled()
  })

  it('executes the registered tender use point and saves only the evidenced result', async () => {
    const db = installInsert()
    const res = await POST(request(file()))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.extractTenderWithAIPlan).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      text: expect.stringContaining('ZB-001'),
      executionEnvironment: 'local',
      fileName: 'tender.pdf',
      mimeType: 'application/pdf',
      base: expect.objectContaining({ confidence: 30 }),
    }))
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      key_info: expect.objectContaining({
        aiRuntime: expect.objectContaining({
          source: 'published_ai_runtime',
          model_invocation_ids: ['invocation-1', 'invocation-2'],
        }),
      }),
      status: 'completed',
    }))
    expect(body.data).toMatchObject({
      id: 'ocr-1',
      keyInfo: { tenderNo: 'ZB-001' },
      confidence: 95,
    })
  })

  it('maps published manual-review failure without saving deterministic output as completed', async () => {
    mocks.extractTenderWithAIPlan.mockRejectedValueOnce(new AIExecutionError(
      'ALL_CANDIDATES_FAILED', 'all failed', 'manual_review', [], 'snapshot-1',
    ))
    const res = await POST(request(file()))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error.code).toBe('TENDER_AI_MANUAL_REVIEW_REQUIRED')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('reports the no-truncation document limit explicitly', async () => {
    mocks.extractTenderWithAIPlan.mockRejectedValueOnce(new TenderAIOutputError(
      'DOCUMENT_TOO_LARGE', '超过单次可审计上限；未静默截断。',
    ))
    const res = await POST(request(file('large.pdf')))
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error.code).toBe('TENDER_DOCUMENT_TOO_LARGE')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('returns DB_ERROR if the evidenced result cannot be saved', async () => {
    installInsert({ message: 'write failed' })
    const res = await POST(request(file()))

    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('DB_ERROR')
  })

  it('maps authentication failures before parsing or execution', async () => {
    const error = new Error('expired')
    error.name = 'AuthError'
    mocks.requireAuth.mockRejectedValueOnce(error)
    const res = await POST(request(file()))

    expect(res.status).toBe(401)
    expect(mocks.parseDocument).not.toHaveBeenCalled()
    expect(mocks.extractTenderWithAIPlan).not.toHaveBeenCalled()
  })

  it('has no legacy ModelPolicy, failover, CLI, environment credential or rule-engine bypass', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/tenders/ocr/route.ts'), 'utf8')

    expect(source).toContain('extractTenderWithAIPlan')
    expect(source).not.toContain('@/lib/ocr/tender-ai')
    expect(source).not.toContain('@/lib/contracts/model-policy')
    expect(source).not.toContain('@/lib/ai/failover')
    expect(source).not.toMatch(/ModelPolicy|recordModelInvocation|resolvePublishedModelPolicy/)
    expect(source).not.toMatch(/AI_GATEWAY|LOCAL_MODEL|OPENAI_API_KEY|lm-studio-cli|rule-engine/)
  })
})
