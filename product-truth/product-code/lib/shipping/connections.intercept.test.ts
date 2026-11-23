// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  connection: null as null | { id: string; connection_status: string },
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { enableSfInterceptAccess } from './connections'
import { SF_INTERCEPT_CONFIRMATION } from './types'

beforeEach(() => {
  mocks.connection = { id: 'connection-1', connection_status: 'connected' }
  mocks.update.mockReset()
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.maybeSingle = async () => ({ data: mocks.connection, error: null })
  builder.update = (patch: Record<string, unknown>) => { mocks.update(patch); return builder }
  builder.then = (resolve: (value: { error: null }) => unknown) => Promise.resolve(resolve({ error: null }))
  mocks.from.mockReset().mockReturnValue(builder)
})

describe('SF intercept capability gate', () => {
  it('requires the exact console-attestation string before touching configuration', async () => {
    await expect(enableSfInterceptAccess('org-1', 'manager-1', { environment: 'production', confirmation: 'confirmed' }))
      .rejects.toMatchObject({ status: 422 })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('refuses to enable the capability without an existing carrier connection', async () => {
    mocks.connection = null
    await expect(enableSfInterceptAccess('org-1', 'manager-1', {
      environment: 'production', confirmation: SF_INTERCEPT_CONFIRMATION,
    })).rejects.toMatchObject({ status: 409 })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('refuses to enable before the saved connection has passed a read-only test', async () => {
    mocks.connection = { id: 'connection-1', connection_status: 'configured' }
    await expect(enableSfInterceptAccess('org-1', 'manager-1', {
      environment: 'production', confirmation: SF_INTERCEPT_CONFIRMATION,
    })).rejects.toMatchObject({ status: 409 })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it.each([
    ['production', 'live'],
    ['sandbox', 'testing'],
  ] as const)('records %s access only after explicit operator confirmation', async (environment, expected) => {
    await enableSfInterceptAccess('org-1', 'manager-1', {
      environment, confirmation: SF_INTERCEPT_CONFIRMATION,
    })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      sf_intercept_access: expected,
      updated_by: 'manager-1',
    }))
  })
})
