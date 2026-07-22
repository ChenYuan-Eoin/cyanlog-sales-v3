/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}))

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return { ...actual, requireAuth: vi.fn() }
})

vi.mock('@/lib/error-log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/documents/source-render', () => ({ extractPdfText: vi.fn() }))

import { AuthDependencyError, AuthError, requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { POST as upload } from './upload/route'
import { DELETE as cancelChunks, POST as uploadChunk } from './upload-chunk/route'
import { POST as mergeChunks } from './merge-chunks/route'

const handlers = [upload, uploadChunk, mergeChunks, cancelChunks]
const context = { params: Promise.resolve({ id: 'contract-1' }) }

function request() {
  return new NextRequest('http://localhost/api/contracts/contract-1/upload', {
    method: 'POST',
  })
}

describe('contract upload route authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(handlers)('maps missing or invalid authentication to 401', async (handler) => {
    ;(requireAuth as any).mockRejectedValue(new AuthError())

    const response = await handler(request(), context)

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('A001')
  })

  it.each(handlers)('maps authentication dependency failure to retryable 503', async (handler) => {
    ;(requireAuth as any).mockRejectedValue(new AuthDependencyError())

    const response = await handler(request(), context)

    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('S003')
  })

  it('does not touch database or storage after authentication fails', async () => {
    ;(requireAuth as any).mockRejectedValue(new AuthDependencyError())

    for (const handler of handlers) {
      await handler(request(), context)
    }

    expect(requireAuth).toHaveBeenCalledTimes(handlers.length)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })
})
