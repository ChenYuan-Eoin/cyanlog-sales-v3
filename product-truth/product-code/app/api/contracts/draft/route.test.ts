/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeAIUsePoint: vi.fn(),
  requireAuth: vi.fn(),
  getDefaultOrgId: vi.fn(),
  listAccessibleUserIds: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/ai/runtime-executor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/runtime-executor')>()
  return { ...actual, executeAIUsePoint: mocks.executeAIUsePoint }
})
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: mocks.getDefaultOrgId,
  listAccessibleUserIds: mocks.listAccessibleUserIds,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { AIExecutionError } from '@/lib/ai/runtime-executor'
import { POST } from './route'

function request(body: unknown): any {
  return { json: async () => body, headers: new Headers(), method: 'POST' }
}

function aiBody(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'ai_generate',
    purpose: '采购一套企业管理系统',
    party_a: '甲方公司',
    party_b: '乙方公司',
    contract_type: '系统服务协议',
    key_terms: '验收后 30 日付款',
    ...overrides,
  }
}

function validContract() {
  return [
    '系统服务协议',
    '甲方：甲方公司',
    '乙方：乙方公司',
    '第一条 合同标的：乙方向甲方交付企业管理系统。',
    '第二条 价款与付款：验收后 30 日内付款。',
    '第三条 履行与交付：乙方按计划完成部署和交付。',
    '第四条 违约责任：违约方依法承担责任。',
    '第五条 争议解决：协商不成向有管辖权法院起诉。',
    '第六条 签署与生效：双方盖章后生效。',
    '本协议一式两份，双方各执一份，具有同等法律效力。'.repeat(8),
  ].join('\n')
}

describe('POST /api/contracts/draft AI runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.VERCEL
    delete process.env.VERCEL_URL
    delete process.env.VERCEL_REGION
    mocks.requireAuth.mockResolvedValue({ id: 'user-1' })
    mocks.getDefaultOrgId.mockResolvedValue('org-1')
    mocks.listAccessibleUserIds.mockResolvedValue({ userIds: ['user-1'] })
    mocks.executeAIUsePoint.mockResolvedValue({
      value: validContract(),
      provider: 'provider-cloud',
      model: 'model-cloud',
      degraded: false,
      usage: { inputTokens: 100, outputTokens: 500, totalTokens: 600, evidence: 'provider' },
      planSnapshotHash: 'hash-draft',
      invocationIds: ['invocation-draft'],
    })
  })

  it('runs ai_generate only through contract.draft.generate and returns runtime evidence', async () => {
    const res = await POST(request(aiBody()))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.executeAIUsePoint).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      usePointId: 'contract.draft.generate',
      executionEnvironment: 'local',
      validateOutput: expect.any(Function),
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.stringContaining('甲方公司') }),
      ]),
    }))
    expect(body.data).toMatchObject({
      content: expect.stringContaining('系统服务协议'),
      mode: 'ai_generate',
      ai_runtime: {
        provider: 'provider-cloud',
        model: 'model-cloud',
        plan_snapshot_hash: 'hash-draft',
        invocation_ids: ['invocation-draft'],
      },
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects request-time provider selection because RoutePolicy owns ordering', async () => {
    const res = await POST(request(aiBody({ provider: 'legacy-cloud' })))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(mocks.executeAIUsePoint).not.toHaveBeenCalled()
  })

  it('returns the published manual-review action without a clause-library model substitute', async () => {
    mocks.executeAIUsePoint.mockRejectedValueOnce(new AIExecutionError(
      'ALL_CANDIDATES_FAILED', 'all failed', 'manual_review', [], 'snapshot-draft',
    ))
    const res = await POST(request(aiBody()))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe('AI_MANUAL_REVIEW_REQUIRED')
    expect(body.error).toContain('模板起草或人工起草')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('keeps template mode deterministic and outside model_invocations', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({
        data: { parsed_text: '甲方：旧甲方\n乙方：旧乙方\n鉴于：旧目的\n其他条款保持不变。' },
        error: null,
      })),
    }
    mocks.from.mockReturnValue(query)

    const res = await POST(request({
      ...aiBody(),
      mode: 'template',
      source_contract_id: 'source-1',
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.mode).toBe('template')
    expect(mocks.executeAIUsePoint).not.toHaveBeenCalled()
    expect(mocks.from).toHaveBeenCalledWith('contracts')
  })

  it('maps authentication failures without executing the model', async () => {
    const error = new Error('expired')
    error.name = 'AuthError'
    mocks.requireAuth.mockRejectedValueOnce(error)

    const res = await POST(request(aiBody()))
    expect(res.status).toBe(401)
    expect(mocks.executeAIUsePoint).not.toHaveBeenCalled()
  })

  it('has no legacy ModelPolicy, failover, CLI, environment credential or rule-engine bypass', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/contracts/draft/route.ts'), 'utf8')

    expect(source).toContain("usePointId: 'contract.draft.generate'")
    expect(source).not.toContain('@/lib/ai/failover')
    expect(source).not.toMatch(/ModelPolicy|generateTextWithFailover|recordModelInvocation/)
    expect(source).not.toMatch(/AI_GATEWAY|LOCAL_MODEL|OPENAI_API_KEY|lm-studio-cli|rule-engine/)
    expect(source).not.toContain("from('clause_library')")
  })
})
