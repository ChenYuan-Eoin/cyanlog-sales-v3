// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { feishuConnectionAdapter } from './feishu'
import { fxiaokeConnectionAdapter } from './fxiaoke'

const adapterContext = { systemOrgId: '00000000-0000-4000-8000-000000000001' }

describe('provider-specific connection schemas', () => {
  it('keeps Feishu limited to AppID and AppSecret while preserving a saved secret for the same app', () => {
    const first = feishuConnectionAdapter.prepare({ appId: 'cli_feishu', appSecret: 'example-feishu-secret' }, null, adapterContext)
    const next = feishuConnectionAdapter.prepare({ appId: 'cli_feishu', appSecret: '' }, first.credentials, adapterContext)

    expect(next).toMatchObject({
      externalTenantId: 'feishu-app:cli_feishu',
      credentials: { appId: 'cli_feishu', appSecret: 'example-feishu-secret' },
    })
    expect(() => feishuConnectionAdapter.prepare({ appId: 'another-app', appSecret: '' }, first.credentials, adapterContext))
      .toThrowError(expect.objectContaining({ code: 'INVALID_CONFIGURATION' }))
  })

  it('requires Fxiaoke AppSecret and permanent code without making those fields part of Feishu', () => {
    const first = fxiaokeConnectionAdapter.prepare({
      appId: 'FSAID_xxx',
      appSecret: 'example-fxiaoke-secret',
      permanentCode: 'permanent-code',
      apiUserId: '10001',
    }, null, adapterContext)
    const next = fxiaokeConnectionAdapter.prepare({
      appId: 'FSAID_xxx',
      appSecret: '',
      permanentCode: '',
      apiUserId: '10002',
    }, first.credentials, adapterContext)

    expect(first.externalTenantId).toBe('pending-FSAID_xxx')
    expect(next.credentials).toMatchObject({
      appSecret: 'example-fxiaoke-secret',
      permanentCode: 'permanent-code',
      apiUserId: '10002',
    })
    expect(() => fxiaokeConnectionAdapter.prepare({ appId: 'other', apiUserId: '10001' }, first.credentials, adapterContext))
      .toThrowError(expect.objectContaining({ code: 'INVALID_CONFIGURATION' }))
  })
})
