/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(),
      listBuckets: vi.fn(),
      createBucket: vi.fn(),
    },
  },
}))

import { requireAuth } from '@/lib/auth'
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

function makeFile(name: string, type = 'image/png'): File {
  return new File(['image'], name, { type })
}

describe('POST /api/upload validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('未登录返回 401', async () => {
    const authError = new Error('Unauthorized')
    authError.name = 'AuthError'
    ;(requireAuth as any).mockRejectedValue(authError)

    const res = await POST(makeFormRequest({ file: makeFile('logo.png') }))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('无效表单数据返回 400 且不访问 Storage', async () => {
    const res = await POST(makeMalformedFormRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_FORM')
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.listBuckets).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.createBucket).not.toHaveBeenCalled()
  })

  it('未提供文件返回 400 且不访问 Storage', async () => {
    const res = await POST(makeFormRequest({ folder: 'logos' }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('NO_FILE')
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.listBuckets).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.createBucket).not.toHaveBeenCalled()
  })

  it('不支持的文件类型返回 400 且不访问 Storage', async () => {
    const res = await POST(makeFormRequest({
      file: makeFile('logo.txt', 'text/plain'),
      folder: 'logos',
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_TYPE')
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.listBuckets).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.createBucket).not.toHaveBeenCalled()
  })
})
