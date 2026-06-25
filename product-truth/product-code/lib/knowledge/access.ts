import { supabaseAdmin } from '@/lib/supabase'
import {
  canManageOrg,
  getDefaultOrgId,
  getUserScopedRoleAssignments,
  type ScopedRoleAssignment,
} from '@/lib/scoped-access'

export type KnowledgePermission = 'view' | 'edit' | 'admin'

export interface KnowledgeAccessPage {
  id: string
  org_id: string
  created_by: string
}

export interface KnowledgePermissionRow {
  page_id: string
  principal_type: 'user' | 'role' | 'org'
  principal_id: string
  permission: KnowledgePermission
}

const PERMISSION_LEVEL: Record<KnowledgePermission, number> = {
  view: 1,
  edit: 2,
  admin: 3,
}

export async function getKnowledgeAccessContext(userId: string) {
  const [orgId, assignments] = await Promise.all([
    getDefaultOrgId(userId),
    getUserScopedRoleAssignments(userId),
  ])

  return { orgId, assignments }
}

export async function fetchKnowledgePermissions(pageIds: string[]): Promise<Map<string, KnowledgePermissionRow[]>> {
  if (pageIds.length === 0) {
    return new Map()
  }

  const { data, error } = await supabaseAdmin
    .from('knowledge_page_permissions')
    .select('page_id, principal_type, principal_id, permission')
    .in('page_id', pageIds)

  if (error) {
    throw error
  }

  const byPageId = new Map<string, KnowledgePermissionRow[]>()
  for (const row of (data || []) as KnowledgePermissionRow[]) {
    const rows = byPageId.get(row.page_id) || []
    rows.push(row)
    byPageId.set(row.page_id, rows)
  }

  return byPageId
}

export function canUseKnowledgePage(
  page: KnowledgeAccessPage,
  permissions: KnowledgePermissionRow[],
  context: {
    userId: string
    orgId: string
    assignments: ScopedRoleAssignment[]
  },
  required: KnowledgePermission
): boolean {
  if (page.org_id !== context.orgId) {
    return false
  }

  if (page.created_by === context.userId || canManageOrg(context.assignments)) {
    return true
  }

  if (permissions.length === 0) {
    return required === 'view'
  }

  const requiredLevel = PERMISSION_LEVEL[required]
  const roleIds = new Set(context.assignments.map((assignment) => assignment.roleId))

  return permissions.some((permission) => {
    if (PERMISSION_LEVEL[permission.permission] < requiredLevel) {
      return false
    }

    if (permission.principal_type === 'org') {
      return permission.principal_id === context.orgId
    }
    if (permission.principal_type === 'user') {
      return permission.principal_id === context.userId
    }
    if (permission.principal_type === 'role') {
      return roleIds.has(permission.principal_id)
    }

    return false
  })
}
