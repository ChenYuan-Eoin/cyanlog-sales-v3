// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ system_org_id: string }>,
  queryError: null as null | { message: string },
  credentials: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const query = {
        select: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(async () => ({ data: mocks.rows, error: mocks.queryError })),
      }
      return query
    }),
  },
}))
vi.mock('./settings', () => ({ loadOAuthCredentials: mocks.credentials }))

import { resolveConfiguredOAuthOrganization } from './sso'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const credentials = { appId: 'FSAID_test', expectedEa: 'example' }

describe('Fxiaoke SSO organization resolution', () => {
  beforeEach(() => {
    mocks.rows.length = 0
    mocks.queryError = null
    mocks.credentials.mockReset().mockResolvedValue(credentials)
  })

  it('resolves exactly one configured organization and refuses to guess across tenants', async () => {
    mocks.rows.push({ system_org_id: first })
    await expect(resolveConfiguredOAuthOrganization()).resolves.toEqual({ orgId: first, credentials })

    mocks.rows.push({ system_org_id: second })
    await expect(resolveConfiguredOAuthOrganization()).rejects.toMatchObject({ code: 'SSO_ORGANIZATION_AMBIGUOUS', status: 409 })
  })

  it('does not accept a browser-selected organization and fails closed when discovery is unavailable', async () => {
    mocks.queryError = { message: 'database unavailable' }
    await expect(resolveConfiguredOAuthOrganization()).rejects.toMatchObject({ code: 'SSO_CONFIGURATION_UNAVAILABLE', status: 503 })
    expect(mocks.credentials).not.toHaveBeenCalled()
  })
})
