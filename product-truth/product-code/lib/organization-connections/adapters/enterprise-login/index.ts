import type { OrganizationConnectionProvider, EnterpriseLoginAdapter } from '../../types'
import { fxiaokeEnterpriseLoginAdapter } from './fxiaoke'

const adapters: Partial<Record<OrganizationConnectionProvider, EnterpriseLoginAdapter>> = {
  fxiaoke: fxiaokeEnterpriseLoginAdapter,
}

export const ENTERPRISE_LOGIN_PROVIDERS = Object.freeze(
  Object.keys(adapters) as OrganizationConnectionProvider[],
)

export function hasEnterpriseLoginAdapter(provider: string): provider is OrganizationConnectionProvider {
  return ENTERPRISE_LOGIN_PROVIDERS.includes(provider as OrganizationConnectionProvider)
}

export function getEnterpriseLoginAdapter(provider: string): EnterpriseLoginAdapter {
  if (!hasEnterpriseLoginAdapter(provider)) {
    throw new Error(`Unsupported enterprise login provider: ${provider}`)
  }
  return adapters[provider]!
}

export { adapters as enterpriseLoginAdapters, fxiaokeEnterpriseLoginAdapter }
