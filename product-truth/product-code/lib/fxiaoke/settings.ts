// REQ: F003 / WP50. Fxiaoke is a thin provider adapter over the shared connection service.
import {
  loadOrganizationConnection,
  loadVerifiedConfigurationForReadOnlyMetadata,
  loadVerifiedConnection,
  previewOrganizationConnection,
  saveOrganizationConnection,
  type ConnectionSummary as SharedConnectionSummary,
} from '@/lib/organization-connections'
import { connectionInput, FxiaokeError, type ConnectionSummary, type Credentials } from './contracts'

function toConnectionSummary(row: SharedConnectionSummary | null): ConnectionSummary | null {
  if (!row) return null
  const appId = typeof row.metadata.appId === 'string' ? row.metadata.appId : ''
  const expectedEa = typeof row.metadata.expectedEa === 'string' ? row.metadata.expectedEa : row.externalTenantId
  const apiUserId = typeof row.metadata.apiUserId === 'string' ? row.metadata.apiUserId : ''
  return {
    appId,
    expectedEa: expectedEa.startsWith('pending-') ? '' : expectedEa,
    apiUserId,
    revision: row.revision,
    configured: row.configured,
    lastCheckedAt: row.lastCheckedAt,
    lastCheckStatus: row.draftCheckStatus,
    lastError: row.lastError,
  }
}

function translate(error: unknown): never {
  if (error instanceof FxiaokeError) throw error
  if (error && typeof error === 'object' && 'code' in error && 'message' in error && 'status' in error) {
    const typed = error as { code: unknown; message: unknown; status: unknown }
    throw new FxiaokeError(
      String(typed.code),
      String(typed.message),
      typeof typed.status === 'number' ? typed.status : 400,
    )
  }
  throw new FxiaokeError('CONFIG_STORAGE_UNAVAILABLE', '组织连接存储暂时不可用，请稍后重试。', 503)
}

export async function loadConnection(orgId: string): Promise<ConnectionSummary | null> {
  try {
    return toConnectionSummary(await loadOrganizationConnection(orgId, 'fxiaoke'))
  } catch (error) {
    return translate(error)
  }
}

export async function saveConnection(orgId: string, actorId: string, raw: unknown) {
  const parsed = connectionInput.safeParse(raw)
  if (!parsed.success) throw new FxiaokeError('INVALID_CONFIGURATION', '请填写有效的 AppID 和员工 ID；密钥不可填写空白。')
  try {
    return toConnectionSummary(await saveOrganizationConnection({
      orgId,
      actorId,
      provider: 'fxiaoke',
      value: parsed.data,
    }))
  } catch (error) {
    return translate(error)
  }
}

// Server-only credential source. Draft values never enter an OAuth flow.
export async function loadOAuthCredentials(orgId: string): Promise<Credentials> {
  try {
    const connection = await loadVerifiedConnection({ orgId, provider: 'fxiaoke' })
    return connection.credentials as unknown as Credentials
  } catch (error) {
    return translate(error)
  }
}

// Narrow server-only credential source for an administrator-triggered, read-only
// object/field schema inspection. It does not activate or synchronize the source.
export async function loadSavedCredentialsForMetadataInspection(orgId: string): Promise<Credentials> {
  try {
    const connection = await loadVerifiedConfigurationForReadOnlyMetadata({
      orgId,
      provider: 'fxiaoke',
      purpose: 'read_only_metadata_inspection',
    })
    return connection.credentials as unknown as Credentials
  } catch (error) {
    return translate(error)
  }
}

export async function previewSavedConnection(orgId: string, revision: string, actorId = 'system') {
  try {
    const result = await previewOrganizationConnection({ orgId, actorId, provider: 'fxiaoke', revision })
    const toPublic = (item: { id: string; name: string; parentId: string | null; status: string }) => ({
      id: item.id,
      name: item.name,
      parentId: item.parentId,
      status: item.status,
    })
    const toEmployee = (item: { id: string; name: string; departmentIds: string[]; primaryDepartmentId: string | null; status: string; loginDisabled: boolean | null }) => ({
      id: item.id,
      name: item.name,
      departmentIds: item.departmentIds,
      primaryDepartmentId: item.primaryDepartmentId,
      status: item.status,
      loginDisabled: item.loginDisabled,
    })
    return {
      ea: result.preview.externalTenantId,
      corpId: '',
      checkedAt: result.preview.checkedAt,
      departments: result.preview.departments.map(toPublic),
      employees: result.preview.employees.map(toEmployee),
      warnings: result.preview.warnings,
      visibility: 'authorized_scope' as const,
      applied: false as const,
    }
  } catch (error) {
    return translate(error)
  }
}
