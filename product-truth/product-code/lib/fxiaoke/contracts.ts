// REQ: F003 / WP91. Direct OpenAPI connection; no MCP dependency.
import { z } from 'zod'

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
export const connectionInput = z.object({
  appId: identifier,
  appSecret: z.string().trim().min(1).max(512).optional(),
  permanentCode: z.string().trim().min(1).max(512).optional(),
  expectedEa: identifier,
  apiUserId: identifier,
  revision: z.string().uuid().nullable(),
}).strict()
export type ConnectionInput = z.infer<typeof connectionInput>
export type Credentials = Required<Omit<ConnectionInput, 'revision'>>
export type ConnectionSummary = {
  appId: string; expectedEa: string; apiUserId: string; revision: string
  configured: boolean; lastCheckedAt: string | null
  lastCheckStatus: 'not_checked' | 'preview_ready' | 'failed'
  lastError: string | null
}
export type DirectoryDepartment = { id: string; name: string; parentId: string | null; status: string }
export type DirectoryEmployee = { id: string; name: string; departmentIds: string[]; status: string; loginDisabled: boolean | null }
export type DirectoryPreview = {
  ea: string; corpId: string; checkedAt: string
  departments: DirectoryDepartment[]; employees: DirectoryEmployee[]
  warnings: string[]; visibility: 'authorized_scope'; applied: false
}
export class FxiaokeError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message); this.name = 'FxiaokeError'
  }
}
