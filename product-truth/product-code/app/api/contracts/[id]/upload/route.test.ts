/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
  listAccessibleUserIds: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    storage: {
      from: vi.fn(),
    },
  },
}))

vi.mock('@/lib/error-log', () => ({
  logError: vi.fn(),
}))

vi.mock('@/lib/contracts/text-extraction', () => ({
  extractContractText: vi.fn(),
}))

import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

function makeMalformedFormRequest(): any {
  return {
    formData: async () => {
      throw new TypeError('invalid multipart')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'multipart/form-data' }),
  }
}

function makeFormRequest(values: Record<string, FormDataEntryValue | null>): any {
  return {
    formData: async () => ({
      get: (name: string) => values[name] ?? null,
    }),
    method: 'POST',
    headers: new Headers({ 'content-type': 'multipart/form-data' }),
  }
}

function makeFile(name: string, type = 'application/pdf'): File {
  return new File(['contract text'], name, { type })
}

describe('POST /api/contracts/[id]/upload validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('无效表单数据返回 400 且不查询组织、合同和存储', async () => {
    const res = await POST(makeMalformedFormRequest(), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(listAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('未提供文件返回 400 且不查询组织、合同和存储', async () => {
    const res = await POST(makeFormRequest({}), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V003')
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(listAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('不支持的文件类型返回 400 且不查询组织、合同和存储', async () => {
    const res = await POST(makeFormRequest({ file: makeFile('contract.txt', 'text/plain') }), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(listAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })
})
