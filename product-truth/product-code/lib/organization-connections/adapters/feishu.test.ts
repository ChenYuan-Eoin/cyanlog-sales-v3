import { afterEach, describe, expect, it, vi } from 'vitest'
import { feishuConnectionAdapter } from './feishu'

const credentials = {
  appId: 'cli_feishu',
  appSecret: 'secret',
  externalTenantId: 'pending-feishu-cli_feishu',
}

function tokenResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Feishu adapter capability boundary', () => {
  it('uses the provider tenant key and does not call a directory endpoint to verify credentials', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => tokenResponse({
      code: 0,
      tenant_access_token: 'token-1',
      tenant_key: 'tenant-real',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(feishuConnectionAdapter.verifyConnection(credentials, { systemOrgId: 'org-1' }))
      .resolves.toMatchObject({
        externalTenantId: 'tenant-real',
        credentialPatch: { externalTenantId: 'tenant-real' },
      })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toContain('/tenant_access_token/internal')
  })

  it('accepts one legacy AppID-derived tenant value for migration but rejects a different real tenant', async () => {
    vi.stubGlobal('fetch', vi.fn(() => tokenResponse({
      code: 0,
      tenant_access_token: 'token-1',
      tenant_key: 'tenant-b',
    })))

    await expect(feishuConnectionAdapter.verifyConnection({
      ...credentials,
      externalTenantId: 'feishu-app:cli_feishu',
    }, { systemOrgId: 'org-1' })).resolves.toMatchObject({ externalTenantId: 'tenant-b' })

    await expect(feishuConnectionAdapter.verifyConnection({
      ...credentials,
      externalTenantId: 'tenant-a',
    }, { systemOrgId: 'org-1' })).rejects.toMatchObject({ code: 'ENTERPRISE_MISMATCH' })
  })
})
