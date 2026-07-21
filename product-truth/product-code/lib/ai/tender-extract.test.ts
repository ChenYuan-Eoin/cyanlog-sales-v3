/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { AIExecutionPlan } from './runtime-plan'
import {
  TenderAIOutputError,
  extractTenderWithAIPlan,
  validateTenderChunkOutput,
} from './tender-extract'

function plan(): AIExecutionPlan {
  return {
    orgId: 'org-1',
    executionEnvironment: 'hosted',
    usePointId: 'tender.document.extract',
    usePointConfigId: 'use-config',
    applicationId: 'tender-app',
    applicationConfigId: 'app-config',
    routeId: 'tender-route',
    routeConfigId: 'route-config',
    failureAction: 'manual_review',
    timeoutMs: 120_000,
    candidates: [],
    snapshot: {} as AIExecutionPlan['snapshot'],
    snapshotHash: 'a'.repeat(64),
  }
}

function base() {
  return {
    confidence: 30,
    scores: [],
    technicalRequirements: [],
    commercialTerms: [],
    timeline: [],
  }
}

function execution(value: Record<string, unknown>, index = 1) {
  return {
    value,
    text: JSON.stringify(value),
    provider: 'provider-cloud',
    model: 'model-cloud',
    modelAssetId: 'model-cloud',
    providerAssetId: 'provider-cloud',
    planSnapshotId: 'snapshot-1',
    planSnapshotHash: 'a'.repeat(64),
    usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, evidence: 'provider' as const },
    latencyMs: 20,
    degraded: false,
    invocationId: `invocation-${index}`,
    invocationIds: [`invocation-${index}`],
    attempts: [],
  }
}

describe('tender.document.extract runtime helper', () => {
  it('validates strict JSON and rejects ambiguous empty output', () => {
    expect(validateTenderChunkOutput(JSON.stringify({
      noRelevantInformation: false,
      tenderNo: 'ZB-001',
      scores: [],
      technicalRequirements: [],
      commercialTerms: [],
      timeline: [],
    }))).toMatchObject({ ok: true, value: { tenderNo: 'ZB-001' } })
    expect(validateTenderChunkOutput('{}')).toMatchObject({ ok: false })
    expect(validateTenderChunkOutput('not-json')).toMatchObject({ ok: false })
  })

  it('uses one published plan for every chunk and aggregates invocation/token evidence', async () => {
    const resolvePlan = vi.fn(async () => plan())
    let index = 0
    const execute = vi.fn(async (input: any) => {
      index += 1
      expect(input.plan).toBeDefined()
      expect(input.usePointId).toBe('tender.document.extract')
      expect(input.validateOutput).toBeTypeOf('function')
      return execution({
        noRelevantInformation: false,
        tenderNo: index === 1 ? 'ZB-001' : undefined,
        scores: index === 1 ? [{ item: '技术方案', weight: 30, maxScore: 30 }] : [],
        technicalRequirements: index === 2 ? ['支持 10000 并发'] : [],
        commercialTerms: [],
        timeline: [],
      }, index)
    })
    const longText = `${'招标编号：ZB-001。'.repeat(500)}\n\n${'技术要求：支持 10000 并发。'.repeat(500)}`

    const result = await extractTenderWithAIPlan({
      orgId: 'org-1',
      text: longText,
      base: base(),
      executionEnvironment: 'hosted',
      fileName: 'tender.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12345,
      concurrency: 2,
    }, { resolvePlan, execute: execute as any, now: () => 100 })

    expect(resolvePlan).toHaveBeenCalledOnce()
    expect(resolvePlan).toHaveBeenCalledWith({
      orgId: 'org-1', usePointId: 'tender.document.extract', executionEnvironment: 'hosted',
    })
    expect(execute.mock.calls.length).toBeGreaterThan(1)
    expect(result.keyInfo).toMatchObject({
      tenderNo: 'ZB-001',
      scores: [expect.objectContaining({ item: '技术方案' })],
      technicalRequirements: ['支持 10000 并发'],
    })
    expect(result.runtime).toMatchObject({
      source: 'published_ai_runtime',
      provider: 'provider-cloud',
      model: 'model-cloud',
      analyzed_chunk_count: execute.mock.calls.length,
      character_coverage_ratio: 1,
      plan_snapshot_hash: 'a'.repeat(64),
      total_tokens: execute.mock.calls.length * 30,
    })
    expect(result.runtime.model_invocation_ids).toHaveLength(execute.mock.calls.length)
  })

  it('fails before plan resolution rather than silently truncating an oversized document', async () => {
    const resolvePlan = vi.fn(async () => plan())
    const execute = vi.fn()
    const input = {
      orgId: 'org-1',
      text: '正文'.repeat(4000),
      base: base(),
      executionEnvironment: 'hosted' as const,
      fileName: 'large.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 99999,
      maxChunks: 1,
    }

    await expect(extractTenderWithAIPlan(input, {
      resolvePlan,
      execute: execute as any,
    })).rejects.toMatchObject({ code: 'DOCUMENT_TOO_LARGE' })
    expect(resolvePlan).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not accept model completion as a business result when every chunk reports no signals', async () => {
    const execute = vi.fn(async () => execution({
      noRelevantInformation: true,
      scores: [],
      technicalRequirements: [],
      commercialTerms: [],
      timeline: [],
    }))

    await expect(extractTenderWithAIPlan({
      orgId: 'org-1',
      text: '普通正文，没有标书字段。',
      base: base(),
      executionEnvironment: 'hosted',
      fileName: 'tender.txt',
      mimeType: 'text/plain',
      sizeBytes: 30,
    }, {
      resolvePlan: vi.fn(async () => plan()),
      execute: execute as any,
    })).rejects.toBeInstanceOf(TenderAIOutputError)
  })

  it('has no legacy policy, failover, CLI, environment credential or rule-engine execution path', () => {
    const source = readFileSync(join(process.cwd(), 'lib/ai/tender-extract.ts'), 'utf8')

    expect(source).toContain("usePointId: 'tender.document.extract'")
    expect(source).not.toContain('@/lib/ai/failover')
    expect(source).not.toContain('@/lib/contracts/model-policy')
    expect(source).not.toContain('@/lib/ocr/tender-ai')
    expect(source).not.toMatch(/AI_GATEWAY|LOCAL_MODEL|OPENAI_API_KEY|lm-studio-cli|rule-engine/)
  })
})
