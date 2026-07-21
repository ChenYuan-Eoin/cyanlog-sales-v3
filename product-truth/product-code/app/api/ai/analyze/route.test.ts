/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeAIUsePoint: vi.fn(),
  getAuthUser: vi.fn(),
  getDefaultOrgId: vi.fn(),
}))

vi.mock('@/lib/ai/runtime-executor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/runtime-executor')>()
  return { ...actual, executeAIUsePoint: mocks.executeAIUsePoint }
})

vi.mock('@/lib/auth', () => ({ getAuthUser: mocks.getAuthUser }))
vi.mock('@/lib/scoped-access', () => ({ getDefaultOrgId: mocks.getDefaultOrgId }))

import { POST } from './route'
import { AIExecutionError } from '@/lib/ai/runtime-executor'

function makeRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/ai/analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAuthUser.mockResolvedValue({ id: 'user-1' })
    mocks.getDefaultOrgId.mockResolvedValue('org-1')
    mocks.executeAIUsePoint.mockResolvedValue({
      provider: 'provider-cloud',
      model: 'model-cloud',
      value: {
        risks: [{ level: 'red', title: '付款风险', description: '周期过长', suggestion: '改为 30 天' }],
        summary: '存在付款风险',
      },
      latencyMs: 42,
      degraded: false,
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, evidence: 'provider' },
      planSnapshotHash: 'hash-1',
      invocationIds: ['invocation-1'],
    })
  })

  it.each([
    {},
    { pageCount: 10 },
    { text: 'abc', pageCount: 0 },
    { text: 'a'.repeat(100001), pageCount: 5 },
  ])('invalid body returns 400 without auth or execution: %j', async (body) => {
    const res = await POST(makeRequest(body))

    expect(res.status).toBe(400)
    expect(mocks.getAuthUser).not.toHaveBeenCalled()
    expect(mocks.executeAIUsePoint).not.toHaveBeenCalled()
  })

  it('requires an authenticated organization before resolving the platform route', async () => {
    mocks.getAuthUser.mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ text: '合同内容', pageCount: 5 }))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.code).toBe('UNAUTHORIZED')
    expect(mocks.executeAIUsePoint).not.toHaveBeenCalled()
  })

  it('executes only the registered generic use point and returns auditable runtime evidence', async () => {
    const res = await POST(makeRequest({ text: '合同内容', pageCount: 5, task: 'semantic' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      provider: 'provider-cloud',
      model: 'model-cloud',
      result: { summary: '存在付款风险' },
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      planSnapshotHash: 'hash-1',
      invocationIds: ['invocation-1'],
    })
    expect(mocks.executeAIUsePoint).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      usePointId: 'generic.ai.analyze',
      executionEnvironment: 'local',
      messages: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
      validateOutput: expect.any(Function),
    }))
  })

  it('rejects a request-time cloud override because RoutePolicy owns model choice', async () => {
    const res = await POST(makeRequest({ text: '合同内容', pageCount: 5, forceCloud: true }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('ROUTE_POLICY_CONTROLLED')
    expect(mocks.executeAIUsePoint).not.toHaveBeenCalled()
  })

  it('maps a published manual-review failure action to an explicit 503', async () => {
    mocks.executeAIUsePoint.mockRejectedValueOnce(new AIExecutionError(
      'ALL_CANDIDATES_FAILED', 'all failed', 'manual_review', [], 'snapshot-1'
    ))

    const res = await POST(makeRequest({ text: '合同内容', pageCount: 5 }))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe('AI_MANUAL_REVIEW_REQUIRED')
  })

  it('invalid JSON body stops before auth and execution', async () => {
    const res = await POST({
      json: async () => { throw new Error('invalid json') },
      method: 'POST',
      headers: new Headers(),
    } as any)

    expect(res.status).toBe(400)
    expect(mocks.getAuthUser).not.toHaveBeenCalled()
    expect(mocks.executeAIUsePoint).not.toHaveBeenCalled()
  })

  it('has no legacy failover, ModelPolicy, CLI or environment credential bypass', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/ai/analyze/route.ts'), 'utf8')

    expect(source).toContain("usePointId: 'generic.ai.analyze'")
    expect(source).not.toContain("@/lib/ai/failover")
    expect(source).not.toContain('reviewWithFailover')
    expect(source).not.toContain('ModelPolicy')
    expect(source).not.toMatch(/AI_GATEWAY|LOCAL_MODEL|OPENAI_API_KEY|lm-studio-cli/)
  })
})
