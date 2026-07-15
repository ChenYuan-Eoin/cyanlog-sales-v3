/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listPublishedAIProviders: vi.fn(),
  getCurrentPublishedModelPolicy: vi.fn(),
  validatePublishedModelPolicy: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

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

import { GET } from './route'

describe('GET /api/configs/ai-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listPublishedAIProviders.mockResolvedValue([
      { config_id: 'provider-1', kind: 'provider', model: 'gpt-5.5' },
    ])
    mocks.getCurrentPublishedModelPolicy.mockResolvedValue({ id: 'polluted-policy' })
    mocks.validatePublishedModelPolicy.mockReturnValue({
      ok: false,
      reasons: ['策略引用了非 provider 配置', '策略包含 unknown 或空模型'],
    })
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
})
