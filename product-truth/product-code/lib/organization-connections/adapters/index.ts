import { feishuConnectionAdapter, feishuDirectoryAdapter } from './feishu'
import { fxiaokeConnectionAdapter, fxiaokeDirectoryAdapter } from './fxiaoke'
import { hasEnterpriseLoginAdapter } from './enterprise-login'
import type {
  DirectoryAdapter,
  OrganizationConnectionAdapter,
  OrganizationConnectionProvider,
  ProviderAdapterCapabilities,
  ProviderCatalogEntry,
} from '../types'

/**
 * Provider catalogue lives independently from implementations. A provider can
 * be visible as "not connected yet" without pretending it has credentials,
 * directory or login behavior.
 */
const providerCatalog = [
  { key: 'fxiaoke', label: '纷享销客', unavailableReason: null },
  { key: 'feishu', label: '飞书', unavailableReason: null },
  { key: 'wecom', label: '企业微信', unavailableReason: '该组织提供方的连接器尚未接入统一配置。' },
  { key: 'dingtalk', label: '钉钉', unavailableReason: '该组织提供方的连接器尚未接入统一配置。' },
] as const satisfies readonly ProviderCatalogEntry[]

/** Independent capability registries. Missing capabilities fail closed. */
const connectionAdapters: Partial<Record<OrganizationConnectionProvider, OrganizationConnectionAdapter>> = {
  fxiaoke: fxiaokeConnectionAdapter,
  feishu: feishuConnectionAdapter,
}

const directoryAdapters: Partial<Record<OrganizationConnectionProvider, DirectoryAdapter>> = {
  fxiaoke: fxiaokeDirectoryAdapter,
  feishu: feishuDirectoryAdapter,
}

for (const entry of providerCatalog) {
  const connection = connectionAdapters[entry.key]
  if (connection && connection.provider !== entry.key) {
    throw new Error(`Connection adapter provider mismatch for ${entry.key}`)
  }
  if (connection && connection.label !== entry.label) {
    throw new Error(`Provider label mismatch for ${entry.key}`)
  }
  if (!connection && !entry.unavailableReason) {
    throw new Error(`Provider ${entry.key} has no connection adapter or unavailable reason`)
  }
  const directory = directoryAdapters[entry.key]
  if (directory && directory.provider !== entry.key) {
    throw new Error(`Directory adapter provider mismatch for ${entry.key}`)
  }
}

export const PROVIDER_CATALOG = Object.freeze(providerCatalog)
export const CONFIGURABLE_PROVIDERS = Object.freeze(
  providerCatalog
    .filter(entry => Boolean(connectionAdapters[entry.key]))
    .map(entry => entry.key),
)
export const DIRECTORY_PROVIDERS = Object.freeze(
  providerCatalog
    .filter(entry => Boolean(directoryAdapters[entry.key]))
    .map(entry => entry.key),
)

export function listProviderCatalog(): readonly ProviderCatalogEntry[] {
  return PROVIDER_CATALOG
}

export function isConfigurableProvider(value: unknown): value is OrganizationConnectionProvider {
  return typeof value === 'string' && CONFIGURABLE_PROVIDERS.includes(value as OrganizationConnectionProvider)
}

export function hasDirectoryAdapter(value: string): value is OrganizationConnectionProvider {
  return DIRECTORY_PROVIDERS.includes(value as OrganizationConnectionProvider)
}

export function getConnectionAdapter(provider: string): OrganizationConnectionAdapter {
  if (!isConfigurableProvider(provider)) {
    throw new Error(`Unsupported configurable organization connection provider: ${provider}`)
  }
  return connectionAdapters[provider]!
}

export function getDirectoryAdapter(provider: string): DirectoryAdapter {
  if (!hasDirectoryAdapter(provider)) {
    throw new Error(`Unsupported organization directory provider: ${provider}`)
  }
  return directoryAdapters[provider]!
}

export function getProviderAdapterCapabilities(provider: string): ProviderAdapterCapabilities {
  const directory = hasDirectoryAdapter(provider) ? directoryAdapters[provider] : null
  return {
    credentialVerification: isConfigurableProvider(provider),
    directoryPreview: Boolean(directory),
    directoryScopeProof: directory?.supportsScopeProof ?? false,
    enterpriseLogin: hasEnterpriseLoginAdapter(provider),
  }
}

/** Compatibility export; new code should use connectionAdapters. */
export const adapters = connectionAdapters
export { connectionAdapters, directoryAdapters }
