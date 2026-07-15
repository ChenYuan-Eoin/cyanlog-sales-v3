/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigationMocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: navigationMocks.redirect,
}))

vi.mock('@/lib/server-auth', () => ({
  getServerAuthToken: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getAuthUserByToken: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { getAuthUserByToken } from '@/lib/auth'
import { getServerAuthToken } from '@/lib/server-auth'
import { supabaseAdmin } from '@/lib/supabase'
import { loadOwnedOcrResultForServer } from './owned-ocr-result'

function makeQuery(result: any) {
  const chain: any = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  return chain
}

describe('loadOwnedOcrResultForServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getServerAuthToken as any).mockResolvedValue('session-token')
    ;(getAuthUserByToken as any).mockResolvedValue({ id: 'user-owner' })
  })

  it('没有服务端会话时重定向登录且不读取 OCR 数据', async () => {
    ;(getServerAuthToken as any).mockResolvedValue(undefined)

    await expect(loadOwnedOcrResultForServer('ocr-1'))
      .rejects.toThrow('NEXT_REDIRECT:/login')

    expect(getAuthUserByToken).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('会话对应用户已失效时重定向登录且不读取 OCR 数据', async () => {
    ;(getAuthUserByToken as any).mockResolvedValue(null)

    await expect(loadOwnedOcrResultForServer('ocr-1'))
      .rejects.toThrow('NEXT_REDIRECT:/login')

    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('详情查询同时限定记录 ID 与当前用户所有权', async () => {
    const query = makeQuery({ data: null, error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const result = await loadOwnedOcrResultForServer('ocr-other-user')

    expect(result).toEqual({ data: null, error: null })
    expect(supabaseAdmin.from).toHaveBeenCalledWith('ocr_results')
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', 'ocr-other-user')
    expect(query.eq).toHaveBeenNthCalledWith(2, 'created_by', 'user-owner')
    expect(query.maybeSingle).toHaveBeenCalledTimes(1)
  })

  it('跨用户 canary 始终用攻击者身份限定查询', async () => {
    const query = makeQuery({ data: null, error: null })
    ;(getAuthUserByToken as any).mockResolvedValue({ id: 'user-attacker' })
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    await loadOwnedOcrResultForServer('ocr-owned-by-victim')

    expect(query.eq).toHaveBeenCalledWith('id', 'ocr-owned-by-victim')
    expect(query.eq).toHaveBeenCalledWith('created_by', 'user-attacker')
  })
})
