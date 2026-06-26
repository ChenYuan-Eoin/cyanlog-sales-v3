/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
}))

vi.mock('@/lib/rules/engine', () => ({
  executeRules: vi.fn(),
}))

import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { executeRules } from '@/lib/rules/engine'
import { POST } from './route'

function makeMalformedRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/rules/test validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('无效 JSON 返回参数错误且不访问组织和规则引擎', async () => {
    const res = await POST(makeMalformedRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('文本长度需在 10-50000 字符之间')
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(executeRules).not.toHaveBeenCalled()
  })
})
