// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))

import { POST } from './route'
import { requireAuth } from '@/lib/auth'

describe('POST /api/contracts/[id]/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as never)
  })

  it('retires the non-CAS direct-write path and requires the unified chunk protocol', async () => {
    const response = await POST(new NextRequest('http://localhost/api/contracts/contract-1/upload', {
      method: 'POST',
    }), { params: Promise.resolve({ id: 'contract-1' }) })

    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({
      error: '直传接口已停用，请使用分块上传协议',
      code: 'CHUNK_UPLOAD_REQUIRED',
    })
  })
})
