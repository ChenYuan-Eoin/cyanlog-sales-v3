/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

vi.mock('@/lib/error-log', () => ({
  logError: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { logError } from '@/lib/error-log'
import { POST } from './route'

function makeMalformedJsonRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/client-errors validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无效 JSON 返回 400 且不记录错误事件', async () => {
    const res = await POST(makeMalformedJsonRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid payload')
    expect(Sentry.captureException).not.toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalled()
  })
})
