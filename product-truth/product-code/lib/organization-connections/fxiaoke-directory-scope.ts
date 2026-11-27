import { createHash } from 'node:crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { OrganizationConnectionError } from './errors'
import { loadVerifiedConnection, readOrganizationDirectory } from './service'
import type { AdapterDirectoryRead } from './types'

const FORMAT = 'fx-roster-v1'
const PROOF_LIFETIME_MS = 30 * 60_000
const MAX_DIRECTORY_RECORDS = 5000
const identifier = z.string().min(1).max(255).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value))
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const lifecycle = z.enum(['active', 'inactive', 'deleted'])
const department = z.strictObject({ id: identifier, parentId: identifier.nullable(), status: lifecycle })
const employee = z.strictObject({
  id: identifier,
  status: lifecycle,
  primaryDepartmentId: identifier,
  secondaryDepartmentIds: z.array(identifier).max(MAX_DIRECTORY_RECORDS),
})
const tenant = z.strictObject({ ea: identifier, corpId: z.string().max(255).regex(/^FSCID_[A-Za-z0-9_-]+$/) })
const principal = z.strictObject({ appId: identifier, apiUserId: identifier })
const manifest = z.strictObject({
  sourceId: z.uuid(),
  connectionRevision: z.uuid(),
  tenant,
  principal,
  capturedAt: z.iso.datetime({ offset: true }),
  scope: z.strictObject({
    rootDepartmentId: identifier,
    wholeCompany: z.literal(true),
    includesStopped: z.literal(true),
    unfiltered: z.literal(true),
  }),
  evidence: z.strictObject({ departmentExportSha256: digest, employeeExportSha256: digest }),
  departments: z.array(department).min(1).max(MAX_DIRECTORY_RECORDS),
  employees: z.array(employee).min(1).max(MAX_DIRECTORY_RECORDS),
})
const proofMetadata = z.strictObject({
  id: z.uuid(),
  capturedAt: z.string(),
  verifiedAt: z.string(),
  expiresAt: z.string(),
  departmentCount: z.number().int().positive(),
  employeeCount: z.number().int().positive(),
})
const foundProof = z.strictObject({ id: z.uuid(), rosterDigest: digest, expiresAt: z.iso.datetime({ offset: true }) })
const receiptOrigin = z.strictObject({ tenant, principal })

type Manifest = z.infer<typeof manifest>
type Roster = Pick<Manifest, 'departments' | 'employees'>
type DirectoryRead = Awaited<ReturnType<typeof readOrganizationDirectory>>
type ScopeFields = Pick<AdapterDirectoryRead, 'scopeVerified' | 'scopeEvidence'> & { scopeExpiresAt?: string }
type EffectiveConnection = Awaited<ReturnType<typeof loadVerifiedConnection>>

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function compareId(left: { id: string }, right: { id: string }) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function rosterDigest(roster: Roster, expectedRoot?: string) {
  const departmentsById = new Map(roster.departments.map(row => [row.id, row]))
  const roots = roster.departments.filter(row => row.parentId === null)
  if (roots.length !== 1 || (expectedRoot && roots[0].id !== expectedRoot) || departmentsById.size !== roster.departments.length) return null

  const rootDepartmentId = roots[0].id
  const connected = new Set([rootDepartmentId])
  for (const departmentRow of roster.departments) {
    const path = new Set<string>()
    let current = departmentRow
    while (!connected.has(current.id)) {
      if (path.has(current.id) || current.parentId === null) return null
      path.add(current.id)
      const parent = departmentsById.get(current.parentId)
      if (!parent) return null
      current = parent
    }
    for (const id of path) connected.add(id)
  }

  const employeeIds = new Set<string>()
  for (const row of roster.employees) {
    const secondary = new Set(row.secondaryDepartmentIds)
    if (employeeIds.has(row.id) || secondary.size !== row.secondaryDepartmentIds.length
      || secondary.has(row.primaryDepartmentId) || !departmentsById.has(row.primaryDepartmentId)
      || row.secondaryDepartmentIds.some(id => !departmentsById.has(id))) return null
    employeeIds.add(row.id)
  }

  return {
    rootDepartmentId,
    rosterDigest: hash([FORMAT, rootDepartmentId,
      [...roster.departments].sort(compareId).map(row => [row.id, row.parentId, row.status]),
      [...roster.employees].sort(compareId).map(row => [row.id, row.status, row.primaryDepartmentId, [...row.secondaryDepartmentIds].sort()]),
    ]),
  }
}

function readRosterDigest(directory: AdapterDirectoryRead, expectedRoot?: string) {
  if (!directory.complete || !directory.departments.length || !directory.employees.length) return null
  const departments = z.array(department).safeParse(directory.departments.map(({ id, parentId, status }) => ({ id, parentId, status })))
  const employees = z.array(employee).safeParse(directory.employees.map(row => ({
    id: row.id,
    status: row.sourceConflict ? 'unconfirmed' : row.status,
    primaryDepartmentId: row.primaryDepartmentId,
    secondaryDepartmentIds: row.departmentIds.filter(id => id !== row.primaryDepartmentId),
  })))
  if (!departments.success || !employees.success
    || directory.employees.some(row => !row.primaryDepartmentId || !row.departmentIds.includes(row.primaryDepartmentId))) return null
  return rosterDigest({ departments: departments.data, employees: employees.data }, expectedRoot)
}

function effectiveOrigin(connection: EffectiveConnection, read: DirectoryRead) {
  const { credentials, sourceId, revision, summary } = connection
  if (sourceId !== read.binding.sourceId || revision !== read.binding.connectionRevision
    || summary.revision !== read.sourceConfigurationRevision || revision !== read.sourceConfigurationRevision
    || summary.externalTenantId !== read.binding.externalTenantId || read.binding.sourceState !== 'verified') return null

  const parsed = receiptOrigin.safeParse({
    tenant: { ea: credentials.expectedEa, corpId: credentials.expectedCorpId },
    principal: { appId: credentials.appId, apiUserId: credentials.apiUserId },
  })
  if (!parsed.success || ![parsed.data.tenant.ea, parsed.data.tenant.corpId].includes(read.binding.externalTenantId)
    || ![parsed.data.tenant.ea, parsed.data.tenant.corpId].every(id => read.verifiedTenantIds.includes(id))) return null
  return {
    ...parsed.data,
    principalDigest: hash([FORMAT, parsed.data.tenant.ea, parsed.data.tenant.corpId, parsed.data.principal.appId, parsed.data.principal.apiUserId]),
  }
}

function scopeUnavailable() {
  return new OrganizationConnectionError('DIRECTORY_SCOPE_PROOF_UNAVAILABLE', '目录范围证据暂时不可用。', 503)
}

export async function recordFxiaokeScopeProof(orgId: string, actorId: string, value: unknown) {
  const parsed = manifest.safeParse(value)
  if (!parsed.success) {
    throw new OrganizationConnectionError('INVALID_SCOPE_PROOF', '请提供带全公司范围、部门层级、人员状态及完整主属和兼岗的管理员核对清单。', 400)
  }
  const input = parsed.data
  const capturedAt = Date.parse(input.capturedAt)
  const now = Date.now()
  if (!Number.isFinite(capturedAt) || capturedAt > now || now - capturedAt >= PROOF_LIFETIME_MS) {
    throw new OrganizationConnectionError('SCOPE_PROOF_EXPIRED', '目录清单采集时间无效或已过期，请重新导出核对。', 409)
  }
  const expected = rosterDigest(input, input.scope.rootDepartmentId)
  if (!expected) {
    throw new OrganizationConnectionError('INVALID_SCOPE_PROOF', '管理员核对清单含重复标识、无效层级或不完整的部门关系。', 400)
  }

  const connection = await loadVerifiedConnection({ orgId, provider: 'fxiaoke', sourceId: input.sourceId })
  if (connection.revision !== input.connectionRevision || connection.summary.revision !== input.connectionRevision
    || connection.credentials.expectedEa !== input.tenant.ea || connection.credentials.expectedCorpId !== input.tenant.corpId
    || connection.credentials.appId !== input.principal.appId || connection.credentials.apiUserId !== input.principal.apiUserId) {
    throw new OrganizationConnectionError('SCOPE_PROOF_SOURCE_MISMATCH', '清单的企业、查询员工或生效配置与当前连接不一致。', 409)
  }
  const read = await readOrganizationDirectory({
    orgId, provider: 'fxiaoke', sourceId: input.sourceId, revision: input.connectionRevision, credentialSource: 'effective',
  })
  const origin = effectiveOrigin(connection, read)
  if (!origin) throw new OrganizationConnectionError('SCOPE_PROOF_SOURCE_MISMATCH', '连接或配置已变化，请重新核对。', 409)
  const observed = readRosterDigest(read.directory, expected.rootDepartmentId)
  if (!observed || observed.rosterDigest !== expected.rosterDigest) {
    throw new OrganizationConnectionError('DIRECTORY_SCOPE_MISMATCH', '清单与生效连接返回的部门、人员状态或主属、兼岗集合不一致，当前只可预览。', 409)
  }

  const { data, error } = await supabaseAdmin.rpc('record_fxiaoke_directory_scope_proof_v1', {
    p_org_id: orgId, p_source_id: input.sourceId, p_actor_id: actorId, p_connection_revision: input.connectionRevision,
    p_external_tenant_id: read.binding.externalTenantId, p_source_updated_at: read.sourceUpdatedAt,
    p_tenant_ea: origin.tenant.ea, p_tenant_corp_id: origin.tenant.corpId, p_principal_digest: origin.principalDigest,
    p_root_department_id: expected.rootDepartmentId, p_captured_at: new Date(capturedAt).toISOString(),
    p_department_export_digest: input.evidence.departmentExportSha256, p_employee_export_digest: input.evidence.employeeExportSha256,
    p_roster_digest: expected.rosterDigest, p_department_count: input.departments.length, p_employee_count: input.employees.length,
  })
  if (error?.code === '42501') throw new OrganizationConnectionError('FORBIDDEN', '当前组织的管理员权限已变化。', 403)
  if (error?.code === '40001' || error?.details === 'SCOPE_PROOF_EXPIRED') {
    throw new OrganizationConnectionError('SCOPE_PROOF_STALE', '清单已过期或生效连接已变化，请重新核对。', 409)
  }
  const result = proofMetadata.safeParse(data)
  if (error || !result.success) throw scopeUnavailable()
  return result.data
}

export async function readFreshFxiaokeScopeProof(read: DirectoryRead): Promise<ScopeFields> {
  const unverified = { scopeVerified: false, scopeEvidence: null }
  if (read.binding.provider !== 'fxiaoke' || read.sourceConfigurationRevision !== read.binding.connectionRevision) return unverified
  const observed = readRosterDigest(read.directory)
  if (!observed) return unverified

  try {
    const connection = await loadVerifiedConnection({ orgId: read.binding.organizationId, provider: 'fxiaoke', sourceId: read.binding.sourceId })
    const origin = effectiveOrigin(connection, read)
    if (!origin) return unverified
    const { data, error } = await supabaseAdmin.rpc('read_fxiaoke_directory_scope_proof_v1', {
      p_org_id: read.binding.organizationId, p_source_id: read.binding.sourceId, p_connection_revision: read.binding.connectionRevision,
      p_external_tenant_id: read.binding.externalTenantId, p_principal_digest: origin.principalDigest,
      p_root_department_id: observed.rootDepartmentId, p_roster_digest: observed.rosterDigest,
    })
    const proof = foundProof.safeParse(data)
    if (error || !proof.success || proof.data.rosterDigest !== observed.rosterDigest
      || Date.parse(proof.data.expiresAt) <= Date.now()) return unverified
    return { scopeVerified: true, scopeEvidence: `${FORMAT}:${proof.data.id}:${proof.data.rosterDigest}`, scopeExpiresAt: proof.data.expiresAt }
  } catch {
    return unverified
  }
}
