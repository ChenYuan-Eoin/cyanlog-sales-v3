export const ORGANIZATION_CONNECTION_PROVIDERS = ['feishu', 'fxiaoke', 'wecom', 'dingtalk'] as const
export type OrganizationConnectionProvider = typeof ORGANIZATION_CONNECTION_PROVIDERS[number]
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

export type ProviderCatalogEntry = {
  key: OrganizationConnectionProvider
  label: string
  /** Human-readable reason when no connection adapter is registered. */
  unavailableReason: string | null
}

export type ProviderAdapterCapabilities = {
  credentialVerification: boolean
  directoryPreview: boolean
  directoryScopeProof: boolean
  enterpriseLogin: boolean
}

export type ProviderCapability = {
  key: OrganizationConnectionProvider
  label: string
  configurable: boolean
  previewAvailable: boolean
  syncAvailable: boolean
  ssoAvailable: boolean
  /** Capability declarations are authoritative; the booleans above remain API compatibility fields. */
  capabilities: ProviderAdapterCapabilities
  fields: CredentialField[]
  unavailableReason: string | null
}

export type ConnectionSummary = {
  sourceId: string
  provider: OrganizationConnectionProvider
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
  /** Storage compatibility is explicit so the UI can keep Production read-only before migrations. */
  storageMode?: 'unified' | 'legacy_fxiaoke_read_only'
}

export type DirectoryPreview = {
  checkedAt: string
  provider: OrganizationConnectionProvider
  externalTenantId: string
  /** Structural integrity of the returned authorized scope. */
  complete: boolean
  /** Independent proof that the returned scope is the whole company directory. */
  scopeVerified: boolean
  scopeEvidence: string | null
  departments: Array<{ id: string; name: string; parentId: string | null; status: string }>
  employees: Array<{
    id: string
    name: string
    departmentIds: string[]
    primaryDepartmentId: string | null
    status: string
    loginDisabled: boolean | null
    employeeNumber?: string | null
    email?: string | null
    phone?: string | null
  }>
  warnings: string[]
  applied: false
}

export type NormalizedDirectoryStatus = 'active' | 'inactive' | 'deleted' | 'unknown'

/** Credential verification only. Directory permissions deliberately do not affect this result. */
export type AdapterVerification = {
  checkedAt: string
  externalTenantId: string
  metadata?: Record<string, unknown>
  credentialPatch?: Record<string, unknown>
}

/** A snapshot of exactly the directory rows the connection is authorized to read. */
export type AdapterDirectoryRead = {
  checkedAt: string
  /** Structural integrity within the returned authorized scope. */
  complete: boolean
  /** Independent evidence that the returned scope is the whole-company directory. */
  scopeVerified: boolean
  scopeEvidence: string | null
  departments: DirectoryPreview['departments']
  employees: DirectoryPreview['employees']
  warnings: string[]
}

export type AdapterContext = {
  systemOrgId: string
}

export type EnterpriseLoginStartInput = {
  redirectUrl: string
  state: string
}

export type EnterpriseLoginCallbackInput = {
  redirectUrl: string
  code: string | null
  providerError: string | null
}

export type EnterpriseLoginResult =
  | { status: 'denied' }
  | {
    status: 'authenticated'
    /**
     * Canonical tenant key stored on organization_sources.external_tenant_id.
     * Provider-specific OAuth tenant values must be verified inside the adapter
     * and normalized to this key before returning.
     */
    connectionExternalTenantId: string
    /** Stable provider subject consumed by the provider-neutral identity resolver. */
    externalUserId: string
  }

/** Provider protocol only. Identity mapping, membership, roles and sessions stay provider-neutral. */
export interface EnterpriseLoginAdapter {
  readonly provider: OrganizationConnectionProvider
  beginAuthorization(
    credentials: Record<string, unknown>,
    input: EnterpriseLoginStartInput,
    context: AdapterContext,
  ): { authorizationUrl: string }
  completeAuthorization(
    credentials: Record<string, unknown>,
    input: EnterpriseLoginCallbackInput,
    context: AdapterContext,
  ): Promise<EnterpriseLoginResult>
}

export type PreparedConnection = {
  credentials: Record<string, unknown>
  metadata: Record<string, unknown>
  externalTenantId: string
}

export interface OrganizationConnectionAdapter {
  readonly provider: OrganizationConnectionProvider
  readonly label: string
  readonly fields: CredentialField[]
  parseInput(value: unknown): Record<string, unknown>
  prepare(input: Record<string, unknown>, previous: Record<string, unknown> | null, context: AdapterContext): PreparedConnection
  verifyConnection(credentials: Record<string, unknown>, context: AdapterContext): Promise<AdapterVerification>
  validateStored(credentials: Record<string, unknown>): Record<string, unknown>
  decryptLegacy?(ciphertext: string, context: AdapterContext): Record<string, unknown>
}

/** Provider protocol for an authorized directory snapshot. It never mutates organization truth. */
export interface DirectoryAdapter {
  readonly provider: OrganizationConnectionProvider
  /** Whether this provider exposes an independent API proof, not merely a complete page loop. */
  readonly supportsScopeProof: boolean
  readDirectory(credentials: Record<string, unknown>, context: AdapterContext): Promise<AdapterDirectoryRead>
  /** Normalize provider wire values so the shared cutover service has no provider branches. */
  normalizeDirectoryStatus(value: string): NormalizedDirectoryStatus
}
