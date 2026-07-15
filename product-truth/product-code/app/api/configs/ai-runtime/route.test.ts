/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listPublishedAIProviders: vi.fn(),
  getCurrentPublishedModelPolicy: vi.fn(),
  validatePublishedModelPolicy: vi.fn(),
  from: vi.fn(),
  assessProviderRuntime: vi.fn(),
  selectRuntimeInvocationEvidence: vi.fn(),
  buildRuntimeSourceSummary: vi.fn(),
  runtimeProviderSourceMeta: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

const accessMocks = vi.hoisted(() => ({
  userHasOrgConfigAccess: vi.fn(),
}))

vi.mock('@/lib/configs/access', () => accessMocks)

vi.mock('@/lib/configs/runtime', () => ({
  listPublishedAIProviders: mocks.listPublishedAIProviders,
}))

vi.mock('@/lib/contracts/model-policy', () => ({
  getCurrentPublishedModelPolicy: mocks.getCurrentPublishedModelPolicy,
  validatePublishedModelPolicy: mocks.validatePublishedModelPolicy,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/configs/ai-runtime-readiness', () => ({
  assessProviderRuntime: mocks.assessProviderRuntime,
}))

vi.mock('@/lib/configs/ai-runtime-invocation-evidence', () => ({
  selectRuntimeInvocationEvidence: mocks.selectRuntimeInvocationEvidence,
}))

vi.mock('@/lib/configs/ai-runtime-source', () => ({
  buildRuntimeSourceSummary: mocks.buildRuntimeSourceSummary,
  runtimeProviderSourceMeta: mocks.runtimeProviderSourceMeta,
}))

import { GET } from './route'

const CANARY_SECRET = 'sk-canary-never-return-this-value'

describe('GET /api/configs/ai-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
    mocks.listPublishedAIProviders.mockResolvedValue([
      { config_id: 'provider-1', kind: 'provider', model: 'gpt-5.5' },
    ])
    mocks.getCurrentPublishedModelPolicy.mockResolvedValue({ id: 'polluted-policy' })
    mocks.validatePublishedModelPolicy.mockReturnValue({
      ok: false,
      reasons: ['策略引用了非 provider 配置', '策略包含 unknown 或空模型'],
    })
    mocks.selectRuntimeInvocationEvidence.mockReturnValue({
      actual: null,
      intended: null,
      requested: null,
      related: null,
    })
    mocks.assessProviderRuntime.mockResolvedValue({ runtime_state: 'builtin_ready' })
    mocks.buildRuntimeSourceSummary.mockReturnValue({ source: 'published' })
    mocks.runtimeProviderSourceMeta.mockReturnValue({ source_kind: 'builtin', source_label: '规则引擎' })
  })

  it('blocks an unsafe policy without reading invocation evidence or writing data', async () => {
    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({
      success: false,
      error: {
        code: 'R003',
        message: 'AI 运行时策略已阻断：当前发布策略不可安全消费，请先显式修复并发布。',
        details: {
          reasons: ['策略引用了非 provider 配置', '策略包含 unknown 或空模型'],
        },
      },
    })
    expect(mocks.getCurrentPublishedModelPolicy).toHaveBeenCalledWith('org-1')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('没有 config:read 时返回 403 且不读取 Provider、策略或运行记录', async () => {
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)

    const res = await GET({ method: 'GET', headers: new Headers() } as any)

    expect(res.status).toBe(403)
    expect(accessMocks.userHasOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'read')
    expect(mocks.listPublishedAIProviders).not.toHaveBeenCalled()
    expect(mocks.getCurrentPublishedModelPolicy).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('keeps the valid response path SELECT-only', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      insert: mocks.insert,
      update: mocks.update,
      delete: mocks.delete,
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.order.mockReturnValue(query)
    query.limit.mockResolvedValue({ data: [], error: null })
    mocks.from.mockReturnValue(query)
    mocks.listPublishedAIProviders.mockResolvedValue([{
      config_id: 'provider-secret-source',
      api_key: CANARY_SECRET,
      model: 'provider-model',
    }])
    mocks.assessProviderRuntime.mockResolvedValue({
      runtime_state: 'builtin_ready',
      runtime_reason: `upstream accidentally echoed ${CANARY_SECRET}`,
    })
    mocks.getCurrentPublishedModelPolicy.mockResolvedValue({
      id: 'policy-26',
      key: 'CONTRACT_REVIEW_DEFAULT',
      name: '合同审核默认模型策略',
      version: 26,
      status: 'published',
      is_current: true,
      timeout_ms: 15000,
      routing_policy: {},
      fallback_policy: {},
      audit_policy: {},
      source_config_ids: [],
      published_at: '2026-07-15T00:00:00.000Z',
      provider_chain: [{
        profile: 'rule_engine',
        provider_kind: 'builtin',
        provider: 'rule-engine',
        model: 'rule-engine',
        runtime_location: 'builtin',
        level: 99,
        timeout_ms: 15000,
        stages: ['structured_rules', 'rule_fallback'],
        role: 'fallback',
        capabilities: ['deterministic_rule_scan'],
        data_boundary: 'rules_only',
        health_check_required: false,
        source_config_id: null,
      }],
    })
    mocks.validatePublishedModelPolicy.mockReturnValue({ ok: true })

    const res = await GET({ method: 'GET', headers: new Headers() } as any)
    const responseText = await res.text()

    expect(res.status).toBe(200)
    expect(responseText).not.toContain(CANARY_SECRET)
    expect(mocks.from).toHaveBeenCalledTimes(2)
    expect(mocks.from).toHaveBeenNthCalledWith(1, 'model_invocations')
    expect(mocks.from).toHaveBeenNthCalledWith(2, 'model_invocations')
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.assessProviderRuntime).toHaveBeenCalledTimes(2)
    for (const [input] of mocks.assessProviderRuntime.mock.calls) {
      expect(input).toMatchObject({ checkRemoteHealth: false })
    }
  })
})
