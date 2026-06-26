/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeMalformedJsonRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/contract-policies/rules/[id]/versions/[versionId]/publish validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无效 JSON 返回 400 且不进入鉴权和数据库', async () => {
    const res = await POST(makeMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'rule-1', versionId: 'version-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(withAuthAndOrg).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('字段类型错误返回 400 且不进入鉴权和数据库', async () => {
    const res = await POST(makeJsonRequest({ gray_release: 'yes' }), {
      params: Promise.resolve({ id: 'rule-1', versionId: 'version-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(withAuthAndOrg).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
