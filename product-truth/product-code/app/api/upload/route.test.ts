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

function makePngFile(name: string, width: number, height: number): File {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return new File([bytes], name, { type: 'image/png' })
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
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('无效表单数据返回 400 且不访问 Storage', async () => {
    const res = await POST(makeMalformedFormRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_FORM')
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.listBuckets).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.createBucket).not.toHaveBeenCalled()
  })

  it('未提供文件返回 400 且不访问 Storage', async () => {
    const res = await POST(makeFormRequest({ folder: 'logos' }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('NO_FILE')
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
    expect(body.error.code).toBe('INVALID_TYPE')
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.listBuckets).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.createBucket).not.toHaveBeenCalled()
  })

  it('拒绝把竖向 Logo 原图直接冒充 favicon', async () => {
    const res = await POST(makeFormRequest({
      file: makePngFile('ones-symbol.png', 714, 884),
      folder: 'favicons',
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('FAVICON_NOT_SQUARE')
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('允许配置中心生成的透明正方形 favicon PNG', async () => {
    const storageBucket = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockReturnValue({
        data: { publicUrl: 'https://cdn.example.com/favicons/user-1_square.png' },
      }),
    }
    ;(supabaseAdmin.storage.from as any).mockReturnValue(storageBucket)

    const res = await POST(makeFormRequest({
      file: makePngFile('ones-symbol-square.png', 512, 512),
      folder: 'favicons',
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.fileName).toMatch(/^favicons\/user-1_.*\.png$/)
  })

  it('上传成功返回 common success envelope', async () => {
    const storageBucket = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockReturnValue({
        data: { publicUrl: 'https://cdn.example.com/avatars/user-1_logo.png' },
      }),
    }
    ;(supabaseAdmin.storage.from as any).mockReturnValue(storageBucket)

    const res = await POST(makeFormRequest({
      file: makeFile('logo.png'),
      folder: 'avatars',
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.url).toBe('https://cdn.example.com/avatars/user-1_logo.png')
    expect(body.data.fileName).toMatch(/^avatars\/user-1_.*\.png$/)
    expect(body.url).toBeUndefined()
  })
})
