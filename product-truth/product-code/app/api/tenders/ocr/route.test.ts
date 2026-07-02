// 测试 app/api/tenders/ocr/route.ts
// 覆盖：认证、文件缺失、解析成功

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/ocr/parser', () => ({
  parseDocument: vi.fn().mockResolvedValue('招标编号：ZB-001\n项目名称：测试项目'),
  isDocumentParsePlaceholder: vi.fn((text: string) => text.startsWith('[')),
}))

vi.mock('@/lib/ocr/tender-parser', () => ({
  extractTenderInfo: vi.fn().mockReturnValue({
    tenderNo: 'ZB-001',
    tenderName: '测试项目',
    budget: '100万',
    deadline: '2024-12-31',
    publisher: '测试采购人',
    contact: '13800138000',
    confidence: 95,
    scores: [{ item: '技术方案', weight: 30, maxScore: 30 }],
    technicalRequirements: ['系统支持 10000 并发'],
    commercialTerms: ['付款方式：30/70'],
    timeline: [{ event: '报名', date: '2024-01-15' }],
  }),
}))

vi.mock('@/lib/ocr/tender-ai', () => ({
  analyzeTenderWithCloudModel: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn().mockResolvedValue('org-1'),
}))

vi.mock('@/lib/contracts/model-policy', () => ({
  resolvePublishedModelPolicy: vi.fn().mockResolvedValue({
    id: 'policy-1',
    version: 2,
    provider_chain: [{
      profile: 'sales_cloud_backup',
      provider_kind: 'openai_compatible',
      provider: 'AI_LEVEL_2',
      model: 'gpt-5.5',
      runtime_location: 'cloud',
      level: 2,
      timeout_ms: 240000,
      stages: ['semantic_review', 'tender_long_document_parse', 'comment_patch_draft', 'report_summary'],
      role: 'fallback',
      capabilities: ['long_context'],
      data_boundary: 'contract_text_allowed',
      health_check_required: true,
      routing: { max_pages: 120, strategy: 'chunked' },
      source_config_id: 'cfg-cloud',
    }],
  }),
  selectReviewExecutionProvider: vi.fn((policy, stage) => (
    policy.provider_chain.find((provider: { stages?: string[] }) => provider.stages?.includes(stage))
    || policy.provider_chain[0]
  )),
  recordModelInvocation: vi.fn().mockResolvedValue({ id: 'invocation-1' }),
}))

import { requireAuth } from '@/lib/auth'
import { analyzeTenderWithCloudModel } from '@/lib/ocr/tender-ai'
import { POST } from './route'

function makeFormRequest(file: File | null): any {
  const formData = {
    get: (name: string) => (name === 'file' ? file : null),
  }
  return {
    formData: async () => formData,
    method: 'POST',
    headers: new Headers(),
  }
}

function makeMalformedFormRequest(): any {
  return {
    formData: async () => {
      throw new TypeError('invalid multipart')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'multipart/form-data' }),
  }
}

function makeFile(name: string, content = 'fake content', type = 'text/plain'): File {
  return new File([content], name, { type })
}

function makeCloudResult(overrides: Record<string, unknown> = {}) {
  const runtime = {
    source: 'cloud_model',
    provider: 'AI_LEVEL_2',
    model: 'gpt-5.5',
    transport: 'openai_compatible_http',
    chunk_count: 1,
    selected_chunk_count: 1,
    analyzed_chunk_count: 1,
    text_length: 1200,
    selected_text_length: 1200,
    analyzed_text_length: 1200,
    coverage_ratio: 1,
    chunk_coverage_ratio: 1,
    character_coverage_ratio: 1,
    processing_ms: 1200,
    concurrency: 1,
    business_signal_count: 9,
    business_signal_domains: 5,
    degraded: false,
    attempt_errors: [],
  }
  return {
    keyInfo: {
      tenderNo: 'ZB-001',
      tenderName: '云模型提取项目',
      budget: '100万',
      deadline: '2024-12-31',
      publisher: '测试采购人',
      contact: '13800138000',
      confidence: 96,
      scores: [{ item: '技术方案', weight: 30, maxScore: 30 }],
      technicalRequirements: ['系统支持 10000 并发'],
      commercialTerms: ['付款方式：30/70'],
      timeline: [{ event: '报名', date: '2024-01-15' }],
      aiRuntime: runtime,
    },
    runtime,
    ...overrides,
  }
}

describe('POST /api/tenders/ocr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(analyzeTenderWithCloudModel as any).mockResolvedValue(makeCloudResult())
  })

  it('未登录 → 401 UNAUTHORIZED', async () => {
    const authErr = new Error('Unauthorized')
    authErr.name = 'AuthError'
    ;(requireAuth as any).mockRejectedValue(authErr)
    const res = await POST(makeFormRequest(makeFile('a.txt')))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('未提供文件 → 400 MISSING_FILE', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const res = await POST(makeFormRequest(null))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('MISSING_FILE')
  })

  it('无效表单数据 → 400 INVALID_FORM 且不解析文件或写数据库', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { parseDocument } = await import('@/lib/ocr/parser')
    const { supabaseAdmin } = await import('@/lib/supabase')

    const res = await POST(makeMalformedFormRequest())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_FORM')
    expect(parseDocument).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('不可提取文本的 PDF → 422 VISUAL_OCR_REQUIRED 且不触发云模型或写数据库', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { parseDocument } = await import('@/lib/ocr/parser')
    const { analyzeTenderWithCloudModel } = await import('@/lib/ocr/tender-ai')
    const { supabaseAdmin } = await import('@/lib/supabase')
    ;(parseDocument as any).mockResolvedValueOnce('[PDF未能提取可复制文本，可能是扫描件，需要接入云端视觉 OCR]')

    const res = await POST(makeFormRequest(makeFile('scan.pdf', '%PDF-1.4', 'application/pdf')))
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error.code).toBe('VISUAL_OCR_REQUIRED')
    expect(analyzeTenderWithCloudModel).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('提供文件 → 200 含结构化信息', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    ;(supabaseAdmin.from as any).mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'ocr-1', confidence: 95 },
        error: null,
      }),
    })

    const res = await POST(makeFormRequest(makeFile('tender.txt')))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.id).toBe('ocr-1')
    expect(body.data.keyInfo.tenderNo).toBe('ZB-001')
    expect(body.data.keyInfo.scores).toHaveLength(1)
    expect(body.data.confidence).toBe(96)
  })

  it('云模型增强成功时记录模型调用证据', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    const { analyzeTenderWithCloudModel } = await import('@/lib/ocr/tender-ai')
    const { recordModelInvocation } = await import('@/lib/contracts/model-policy')
    ;(analyzeTenderWithCloudModel as any).mockResolvedValueOnce({
      keyInfo: {
        tenderNo: 'ZB-001',
        tenderName: '云模型提取项目',
        confidence: 100,
        scores: [{ item: '技术方案', weight: 30, maxScore: 30 }],
        technicalRequirements: ['支持长 PDF 分块解析'],
        commercialTerms: ['验收后付款'],
        timeline: [{ event: '投标截止', date: '2026-08-01' }],
        aiRuntime: {
          source: 'cloud_model',
          provider: 'AI_LEVEL_2',
          model: 'gpt-5.5',
          transport: 'openai_compatible_http',
          chunk_count: 3,
          selected_chunk_count: 3,
          analyzed_chunk_count: 3,
          text_length: 1800,
          selected_text_length: 1800,
          analyzed_text_length: 1800,
          coverage_ratio: 1,
          chunk_coverage_ratio: 1,
          character_coverage_ratio: 1,
          processing_ms: 1300,
          concurrency: 2,
          business_signal_count: 6,
          business_signal_domains: 4,
          degraded: false,
          attempt_errors: [],
        },
      },
      runtime: {
        source: 'cloud_model',
        provider: 'AI_LEVEL_2',
        model: 'gpt-5.5',
        transport: 'openai_compatible_http',
        chunk_count: 3,
        selected_chunk_count: 3,
        analyzed_chunk_count: 3,
        text_length: 1800,
        selected_text_length: 1800,
        analyzed_text_length: 1800,
        coverage_ratio: 1,
        chunk_coverage_ratio: 1,
        character_coverage_ratio: 1,
        processing_ms: 1300,
        concurrency: 2,
        business_signal_count: 6,
        business_signal_domains: 4,
        degraded: false,
        attempt_errors: [],
      },
    })
    ;(supabaseAdmin.from as any).mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'ocr-1', confidence: 100 },
        error: null,
      }),
    })

    const res = await POST(makeFormRequest(makeFile('tender.pdf', '招标编号：ZB-001', 'application/pdf')))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(analyzeTenderWithCloudModel).toHaveBeenCalledWith(
      '招标编号：ZB-001\n项目名称：测试项目',
      expect.any(Object),
      expect.objectContaining({
        orgId: 'org-1',
        preferredProvider: 'sales_cloud_backup',
        maxChunks: 80,
      })
    )
    expect(recordModelInvocation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      modelPolicyId: 'policy-1',
      provider: 'AI_LEVEL_2',
      model: 'gpt-5.5',
      phase: 'tender_long_document_parse',
      status: 'completed',
      degraded: false,
    }))
    expect(body.data.keyInfo.aiRuntime.model_invocation_id).toBe('invocation-1')
  })

  it('云端模型不可用时 → 503 且不保存为 completed 解析结果', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    const { recordModelInvocation } = await import('@/lib/contracts/model-policy')
    ;(analyzeTenderWithCloudModel as any).mockRejectedValueOnce(new Error('cloud timeout'))

    const res = await POST(makeFormRequest(makeFile('tender.pdf', '招标编号：ZB-001', 'application/pdf')))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error.code).toBe('TENDER_CLOUD_MODEL_UNAVAILABLE')
    expect(body.error.message).toContain('cloud timeout')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(recordModelInvocation).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'tender_long_document_parse',
      status: 'failed',
      fallbackReason: 'tender_cloud_parse_failed',
    }))
  })

  it('模型策略没有发布长文档云端阶段时 → 503 且不调用模型或保存结果', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    const { resolvePublishedModelPolicy, recordModelInvocation } = await import('@/lib/contracts/model-policy')
    ;(resolvePublishedModelPolicy as any).mockResolvedValueOnce({
      id: 'policy-no-tender',
      version: 3,
      provider_chain: [{
        profile: 'sales_cloud_backup',
        provider_kind: 'openai_compatible',
        provider: 'AI_LEVEL_2',
        model: 'gpt-5.5',
        runtime_location: 'cloud',
        level: 2,
        timeout_ms: 240000,
        stages: ['semantic_review', 'comment_patch_draft', 'report_summary'],
        role: 'fallback',
        capabilities: ['semantic_clause_review'],
        data_boundary: 'contract_text_allowed',
        health_check_required: true,
        routing: { max_pages: 120, strategy: 'chunked' },
        source_config_id: 'cfg-cloud',
      }],
    })

    const res = await POST(makeFormRequest(makeFile('long-tender.pdf', '招标编号：ZB-001', 'application/pdf')))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error.code).toBe('TENDER_CLOUD_MODEL_UNAVAILABLE')
    expect(body.error.message).toContain('未发布支持 tender_long_document_parse')
    expect(analyzeTenderWithCloudModel).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(recordModelInvocation).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'tender_long_document_parse',
      status: 'failed',
      modelPolicyId: 'policy-no-tender',
    }))
  })

  it('云端模型只解析部分已选片段时 → 503 且不保存结果', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    ;(analyzeTenderWithCloudModel as any).mockResolvedValueOnce(makeCloudResult({
      runtime: {
        source: 'cloud_model',
        provider: 'AI_LEVEL_2',
        model: 'gpt-5.5',
        transport: 'openai_compatible_http',
        chunk_count: 6,
        selected_chunk_count: 6,
        analyzed_chunk_count: 3,
        text_length: 48_000,
        selected_text_length: 48_000,
        analyzed_text_length: 24_000,
        coverage_ratio: 0.5,
        chunk_coverage_ratio: 0.5,
        character_coverage_ratio: 0.5,
        processing_ms: 3200,
        concurrency: 2,
        business_signal_count: 9,
        business_signal_domains: 5,
        degraded: true,
        attempt_errors: ['chunk_4 timeout'],
      },
    }))

    const res = await POST(makeFormRequest(makeFile('long-tender.pdf', '招标编号：ZB-001', 'application/pdf')))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error.code).toBe('TENDER_CLOUD_MODEL_UNAVAILABLE')
    expect(body.error.message).toContain('仅解析 3/6 个已选片段')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('云端模型未提取业务字段时 → 503 且不保存结果', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    const emptyRuntime = {
      source: 'cloud_model',
      provider: 'AI_LEVEL_2',
      model: 'gpt-5.5',
      transport: 'openai_compatible_http',
      chunk_count: 1,
      selected_chunk_count: 1,
      analyzed_chunk_count: 1,
      text_length: 1200,
      selected_text_length: 1200,
      analyzed_text_length: 1200,
      coverage_ratio: 1,
      chunk_coverage_ratio: 1,
      character_coverage_ratio: 1,
      processing_ms: 1200,
      concurrency: 1,
      business_signal_count: 0,
      business_signal_domains: 0,
      degraded: false,
      attempt_errors: [],
    }
    ;(analyzeTenderWithCloudModel as any).mockResolvedValueOnce({
      keyInfo: {
        confidence: 10,
        scores: [],
        technicalRequirements: [],
        commercialTerms: [],
        timeline: [],
        aiRuntime: emptyRuntime,
      },
      runtime: emptyRuntime,
    })

    const res = await POST(makeFormRequest(makeFile('tender.pdf', '招标编号：ZB-001', 'application/pdf')))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error.code).toBe('TENDER_CLOUD_MODEL_UNAVAILABLE')
    expect(body.error.message).toContain('未提取到业务字段')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('DB 插入失败 → 500 DB_ERROR', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    ;(supabaseAdmin.from as any).mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'DB connection failed' },
      }),
    })

    const res = await POST(makeFormRequest(makeFile('a.txt')))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('DB_ERROR')
  })
})
