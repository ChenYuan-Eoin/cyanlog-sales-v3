export const ORGANIZATION_CONNECTION_PROVIDERS = ['feishu', 'fxiaoke', 'wecom', 'dingtalk'] as const
export type OrganizationConnectionProvider = typeof ORGANIZATION_CONNECTION_PROVIDERS[number]
export type ConfigurableProvider = 'feishu' | 'fxiaoke'
export type ConnectionState = 'unconfigured' | 'configured' | 'verified' | 'failed' | 'disabled'
export type DraftCheckStatus = 'not_checked' | 'preview_ready' | 'failed'

export type CredentialField = {
  key: string
  label: string
  type: 'text' | 'password'
  placeholder: string
  help: string
  secret: boolean
}

export type ProviderCapability = {
  key: OrganizationConnectionProvider
  label: string
  configurable: boolean
  previewAvailable: boolean
  syncAvailable: boolean
  fields: CredentialField[]
  unavailableReason: string | null
}

export type ConnectionSummary = {
  sourceId: string
  provider: ConfigurableProvider
  externalTenantId: string
  revision: string
  state: ConnectionState
  draftCheckStatus: DraftCheckStatus
  configured: boolean
  effectiveVerified: boolean
  metadata: Record<string, unknown>
  lastCheckedAt: string | null
  lastVerifiedAt: string | null
  lastError: string | null
}

export type DirectoryPreview = {
  checkedAt: string
  provider: ConfigurableProvider
  externalTenantId: string
  departments: Array<{ id: string; name: string; parentId: string | null; status: string }>
  employees: Array<{ id: string; name: string; departmentIds: string[]; status: string; loginDisabled: boolean | null }>
  warnings: string[]
  applied: false
}

export type AdapterVerification = {
  checkedAt: string
  externalTenantId: string
  metadata?: Record<string, unknown>
  credentialPatch?: Record<string, unknown>
  departments?: DirectoryPreview['departments']
  employees?: DirectoryPreview['employees']
  warnings?: string[]
}

export type AdapterContext = {
  systemOrgId: string
}

export type PreparedConnection = {
  credentials: Record<string, unknown>
  metadata: Record<string, unknown>
  externalTenantId: string
}

export interface OrganizationConnectionAdapter {
  readonly provider: ConfigurableProvider
  readonly label: string
  readonly fields: CredentialField[]
  readonly previewAvailable: boolean
  readonly syncAvailable: boolean
  parseInput(value: unknown): Record<string, unknown>
  prepare(input: Record<string, unknown>, previous: Record<string, unknown> | null, context: AdapterContext): PreparedConnection
  verify(credentials: Record<string, unknown>, context: AdapterContext): Promise<AdapterVerification>
  validateStored(credentials: Record<string, unknown>): Record<string, unknown>
  decryptLegacy?(ciphertext: string, context: AdapterContext): Record<string, unknown>
}
