import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractJsonObject, mergeTenderAIResults, analyzeTenderWithCloudModel, selectTenderChunks } from './tender-ai'
import type { TenderKeyInfo } from './tender-parser'
import type { Chunk } from '@/lib/rag/chunker'

const mocks = vi.hoisted(() => ({
  generateTextWithFailover: vi.fn(),
}))

vi.mock('@/lib/ai/failover', () => ({
  generateTextWithFailover: mocks.generateTextWithFailover,
}))

function baseTenderInfo(overrides: Partial<TenderKeyInfo> = {}): TenderKeyInfo {
  return {
    confidence: 0,
    scores: [],
    technicalRequirements: [],
    commercialTerms: [],
    timeline: [],
    ...overrides,
  }
}

describe('tender cloud AI parsing helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts JSON object from reasoning and fenced output', () => {
    const parsed = extractJsonObject('<think>ignore</think>\n```json\n{"tenderName":"智慧平台"}\n```')
    expect(parsed).toEqual({ tenderName: '智慧平台' })
  })

  it('merges cloud extraction with deterministic tender fields', () => {
    const merged = mergeTenderAIResults(baseTenderInfo({
      tenderNo: 'ZB-001',
      scores: [{ item: '技术方案', weight: 30, maxScore: 30 }],
      confidence: 20,
    }), [{
      tenderName: '省医疗云平台建设',
      budget: '500 万元',
      scores: [{ item: '商务报价', weight: 40, maxScore: 40 }],
      technicalRequirements: ['必须支持国产化数据库'],
      commercialTerms: ['付款方式：验收后付款'],
      timeline: [{ event: '投标截止', date: '2026-08-01' }],
    }])

    expect(merged.tenderNo).toBe('ZB-001')
    expect(merged.tenderName).toBe('省医疗云平台建设')
    expect(merged.scores.map((score) => score.item)).toEqual(['技术方案', '商务报价'])
    expect(merged.technicalRequirements).toContain('必须支持国产化数据库')
    expect(merged.timeline).toContainEqual({ event: '投标截止', date: '2026-08-01' })
    expect(merged.confidence).toBeGreaterThan(20)
  })

  it('selects long tender chunks from edges, high-signal sections, and the whole document', () => {
    const chunks: Chunk[] = Array.from({ length: 12 }, (_, index) => ({
      index,
      content: `普通正文 ${index}`,
      metadata: {},
    }))
    chunks[8].content = '评分标准：技术分 40 分，商务分 20 分'
    chunks[10].content = '付款、质保、保证金、投标截止等商务条款'

    const selected = selectTenderChunks(chunks, 6).map((chunk) => chunk.index)

    expect(selected).toContain(0)
    expect(selected).toContain(11)
    expect(selected).toContain(8)
    expect(selected).toContain(10)
    expect(selected).toHaveLength(6)
    expect(selected).toEqual([...selected].sort((left, right) => left - right))
  })

  it('records character coverage and runtime evidence for cloud chunk parsing', async () => {
    mocks.generateTextWithFailover
      .mockResolvedValueOnce({
        text: '{"tenderName":"智慧云平台","technicalRequirements":["支持国产化数据库"]}',
        provider: 'AI_LEVEL_2',
        model: 'gpt-5.5',
        providerKind: 'openai_compatible',
        transport: 'openai_compatible_http',
        degraded: false,
        attemptErrors: [],
      })
      .mockResolvedValueOnce({
        text: '{"commercialTerms":["付款方式：验收后付款"],"timeline":[{"event":"投标截止","date":"2026-08-01"}]}',
        provider: 'AI_LEVEL_2',
        model: 'gpt-5.5',
        providerKind: 'openai_compatible',
        transport: 'openai_compatible_http',
        degraded: false,
        attemptErrors: [],
      })

    const longText = [
      `项目名称：智慧云平台\n技术要求：支持国产化数据库。${'普通正文'.repeat(1400)}`,
      `商务条款：付款方式：验收后付款。投标截止：2026-08-01。${'补充正文'.repeat(1400)}`,
    ].join('\n\n')
    const result = await analyzeTenderWithCloudModel(longText, baseTenderInfo(), {
      orgId: 'org-1',
      maxChunks: 2,
      concurrency: 2,
    })

    expect(result?.runtime.provider).toBe('AI_LEVEL_2')
    expect(result?.runtime.model).toBe('gpt-5.5')
    expect(result?.runtime.transport).toBe('openai_compatible_http')
    expect(result?.runtime.selected_chunk_count).toBe(2)
    expect(result?.runtime.analyzed_chunk_count).toBe(2)
    expect(result?.runtime.business_signal_count).toBeGreaterThan(0)
    expect(result?.runtime.business_signal_domains).toBeGreaterThanOrEqual(2)
    expect(result?.runtime.character_coverage_ratio).toBeGreaterThan(0)
    expect(result?.runtime.character_coverage_ratio).toBeLessThanOrEqual(1)
    expect(result?.runtime.coverage_ratio).toBe(result?.runtime.character_coverage_ratio)
    expect(result?.keyInfo.technicalRequirements).toContain('支持国产化数据库')
    expect(result?.keyInfo.commercialTerms).toContain('付款方式：验收后付款')
    expect(mocks.generateTextWithFailover.mock.calls[0][1]).toMatchObject({
      orgId: 'org-1',
      preferredProvider: 'cloud',
    })
  })

  it('retries a chunk when the cloud model returns invalid JSON once', async () => {
    mocks.generateTextWithFailover
      .mockResolvedValueOnce({
        text: '这里不是 JSON',
        provider: 'AI_LEVEL_2',
        model: 'gpt-5.5',
        providerKind: 'openai_compatible',
        transport: 'openai_compatible_http',
        degraded: false,
        attemptErrors: [],
      })
      .mockResolvedValueOnce({
        text: '{"tenderName":"重试后成功","commercialTerms":["付款方式：验收后付款"],"timeline":[{"event":"投标截止","date":"2026-08-01"}]}',
        provider: 'AI_LEVEL_2',
        model: 'gpt-5.5',
        providerKind: 'openai_compatible',
        transport: 'openai_compatible_http',
        degraded: false,
        attemptErrors: [],
      })

    const result = await analyzeTenderWithCloudModel('付款方式：验收后付款。投标截止：2026-08-01。'.repeat(200), baseTenderInfo(), {
      orgId: 'org-1',
      maxChunks: 1,
      concurrency: 1,
    })

    expect(result?.keyInfo.tenderName).toBe('重试后成功')
    expect(result?.runtime.analyzed_chunk_count).toBe(1)
    expect(result?.runtime.degraded).toBe(false)
    expect(result?.runtime.attempt_errors.join('\n')).toContain('chunk_0_attempt_1')
    expect(mocks.generateTextWithFailover).toHaveBeenCalledTimes(2)
  })

  it('rejects cloud chunk parsing when the model returns no business signals', async () => {
    mocks.generateTextWithFailover.mockResolvedValueOnce({
      text: '{}',
      provider: 'AI_LEVEL_2',
      model: 'gpt-5.5',
      providerKind: 'openai_compatible',
      transport: 'openai_compatible_http',
      degraded: false,
      attemptErrors: [],
    })

    await expect(analyzeTenderWithCloudModel('普通正文'.repeat(1000), baseTenderInfo(), {
      orgId: 'org-1',
      maxChunks: 1,
      concurrency: 1,
    })).rejects.toThrow('no business signals')
  })
})
