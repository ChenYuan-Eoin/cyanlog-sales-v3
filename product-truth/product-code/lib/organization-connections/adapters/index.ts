import { feishuConnectionAdapter } from './feishu'
import { fxiaokeConnectionAdapter } from './fxiaoke'
import type { ConfigurableProvider, OrganizationConnectionAdapter } from '../types'

const adapters = {
  fxiaoke: fxiaokeConnectionAdapter,
  feishu: feishuConnectionAdapter,
} satisfies Record<ConfigurableProvider, OrganizationConnectionAdapter>

export function getConnectionAdapter(provider: string): OrganizationConnectionAdapter {
  if (provider !== 'fxiaoke' && provider !== 'feishu') {
    throw new Error(`Unsupported configurable organization connection provider: ${provider}`)
  }
  return adapters[provider]
}

export { adapters }
