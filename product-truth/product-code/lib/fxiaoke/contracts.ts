// REQ: F003 / WP91. Direct OpenAPI connection; no MCP dependency.
import { z } from 'zod'

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
export const discoveryInput = z.object({
  appId: identifier,
  appSecret: z.string().trim().min(1).max(512),
  permanentCode: z.string().trim().min(1).max(512),
}).strict()
export const connectionInput = z.object({
  appId: identifier,
  appSecret: z.string().trim().min(1).max(512).optional(),
  permanentCode: z.string().trim().min(1).max(512).optional(),
  expectedEa: identifier.optional(),
  apiUserId: identifier,
  revision: z.string().uuid().nullable(),
}).strict()
export type ConnectionInput = z.infer<typeof connectionInput>
export type Credentials = Required<Omit<ConnectionInput, 'revision'>> & {
  expectedCorpId?: string
}
export type ConnectionSummary = {
  appId: string; expectedEa: string; apiUserId: string; revision: string
  configured: boolean; lastCheckedAt: string | null
  lastCheckStatus: 'not_checked' | 'preview_ready' | 'failed'
  lastError: string | null
}
export type DirectoryDepartment = { id: string; name: string; parentId: string | null; status: string }
export type DirectoryLifecycleStatus = 'active' | 'inactive' | 'deleted' | 'unknown'

function normalizedStatus(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().toLowerCase()
    : 'unknown'
}

// Fxiaoke select fields are returned as strings. Keep the wire-value mapping in
// one place so directory sync and SSO cannot disagree about lifecycle state.
export function normalizeFxiaokePersonnelStatus(value: unknown): DirectoryLifecycleStatus {
  const normalized = normalizedStatus(value)
  if (['0', 'active', 'enabled', '启用', '正常'].includes(normalized)) return 'active'
  if (['1', 'inactive', 'disabled', 'resigned', 'frozen', '停用', '离职', '冻结'].includes(normalized)) return 'inactive'
  return 'unknown'
}

export function normalizeFxiaokeDepartmentStatus(value: unknown): DirectoryLifecycleStatus {
  const normalized = normalizedStatus(value)
  if (['0', 'active', 'enabled', '启用', '正常'].includes(normalized)) return 'active'
  if (['1', 'inactive', 'disabled', '停用'].includes(normalized)) return 'inactive'
  if (['2', 'deleted', '删除'].includes(normalized)) return 'deleted'
  return 'unknown'
}
export function normalizeIdentityPhone(value: string | null | undefined) {
  if (!value?.trim()) return null
  const digits = value.replace(/[^0-9]/g, '')
  if (/^1[3-9][0-9]{9}$/.test(digits)) return `+86${digits}`
  if (/^861[3-9][0-9]{9}$/.test(digits)) return `+${digits}`
  if (/^[1-9][0-9]{7,14}$/.test(digits)) return `+${digits}`
  return null
}

export type DirectoryEmployeeSourceConflict = 'primary_department' | 'employee_profile' | 'phone_claim'
export type DirectoryEmployee = {
  id: string
  name: string
  departmentIds: string[]
  primaryDepartmentId: string | null
  status: string
  loginDisabled: boolean | null
  employeeNumber: string | null
  email: string | null
  phone: string | null
  sourceConflict?: DirectoryEmployeeSourceConflict
}
export type VerifiedEmployeeIdentity = {
  externalSubject: string
  directoryUserId: string
  phone: string | null
  employeeNumber: string | null
  displayName: string
  status: string
  loginDisabled: boolean | null
  lifeStatus: string | null
  deleted: boolean
}
export type DirectoryPreview = {
  ea: string; corpId: string; checkedAt: string
  departments: DirectoryDepartment[]; employees: DirectoryEmployee[]
  complete: boolean
  warnings: string[]; visibility: 'authorized_scope'; applied: false
}
export class FxiaokeError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message); this.name = 'FxiaokeError'
  }
}
