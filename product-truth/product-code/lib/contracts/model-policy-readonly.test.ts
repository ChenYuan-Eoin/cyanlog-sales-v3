import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.order.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  return { from: vi.fn(() => query), query, listPublishedAIProviders: vi.fn() }
})

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/configs/runtime', () => ({
  listPublishedAIProviders: mocks.listPublishedAIProviders,
}))

import {
  getCurrentPublishedModelPolicy,
  resolvePublishedModelPolicy,
} from './model-policy'

describe('getCurrentPublishedModelPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.query.select.mockReturnValue(mocks.query)
    mocks.query.eq.mockReturnValue(mocks.query)
    mocks.query.order.mockReturnValue(mocks.query)
    mocks.query.limit.mockReturnValue(mocks.query)
    mocks.listPublishedAIProviders.mockResolvedValue([])
    mocks.query.maybeSingle.mockResolvedValue({
      data: {
        id: 'policy-25',
        org_id: 'org-1',
        key: 'CONTRACT_REVIEW_DEFAULT',
        name: '合同审核默认模型策略',
        version: 25,
        status: 'published',
        is_current: true,
        provider_chain: [],
        routing_policy: {},
        timeout_ms: 45000,
        fallback_policy: {},
        audit_policy: {},
        source_config_ids: [],
        published_at: '2026-07-15T00:00:00.000Z',
      },
      error: null,
    })
  })

  it('uses SELECT only and never mutates policy state', async () => {
    const result = await getCurrentPublishedModelPolicy('org-1')

    expect(result?.version).toBe(25)
    expect(mocks.from).toHaveBeenCalledWith('model_policies')
    expect(mocks.query.select).toHaveBeenCalledWith('*')
    expect(mocks.query.insert).not.toHaveBeenCalled()
    expect(mocks.query.update).not.toHaveBeenCalled()
    expect(mocks.query.delete).not.toHaveBeenCalled()
  })

  it('blocks business consumption instead of auto-publishing a replacement policy', async () => {
    await expect(resolvePublishedModelPolicy('org-1', 'user-1')).rejects.toMatchObject({
      name: 'ModelPolicyConfigurationError',
      reasons: expect.arrayContaining(['当前模型策略缺少完整审计/路由字段']),
    })

    expect(mocks.listPublishedAIProviders).toHaveBeenCalledWith('org-1')
    expect(mocks.query.insert).not.toHaveBeenCalled()
    expect(mocks.query.update).not.toHaveBeenCalled()
    expect(mocks.query.delete).not.toHaveBeenCalled()
  })
})
