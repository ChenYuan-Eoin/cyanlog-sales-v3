// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}))
vi.mock('@/lib/error-log', () => ({ logError: vi.fn() }))

import { DELETE } from './route'
import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

const contractId = 'contract-1'
const uploadId = '019f6d1a-3b21-7cc0-8f4e-123456789abc'
const context = { params: Promise.resolve({ id: contractId }) }

function contractQuery(storagePath: string | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: contractId,
        created_by: 'user-1',
        updated_at: '2026-07-17T10:00:00.000Z',
        storage_path: storagePath,
      },
      error: null,
    }),
  }
}

describe('DELETE /api/contracts/[id]/upload-chunk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as never)
  })

  it('rejects cancellation after this upload session is already the committed source', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      contractQuery(`${contractId}/${uploadId}_source.docx`) as never
    )

    const response = await DELETE(new NextRequest(`http://localhost/api/contracts/${contractId}/upload-chunk`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId, chunkCount: 1 }),
    }), context)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: '上传会话已经提交，不能再取消' })
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })
})
