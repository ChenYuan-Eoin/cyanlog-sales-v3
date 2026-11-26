import type { NextRequest } from 'next/server'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { rolePermissionsEditBlockReason, type OrgVisibleRole } from '@/lib/org-role-permissions'
import { supabaseAdmin } from '@/lib/supabase'
import { isRoleId, withRolePermissionContext } from './context'

type RoleMetadataOperation = 'create' | 'rename' | 'archive'

export function roleMetadata(role: OrgVisibleRole, canEdit: boolean) {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    metadata_editable: canEdit && rolePermissionsEditBlockReason(role.code) === null,
    metadata_revision: role.role_revision,
  }
}

export async function mutateOrgRoleMetadata(req: NextRequest, operation: RoleMetadataOperation, roleId?: string) {
  return withRolePermissionContext(req, async ({ orgId, canEdit }, actorId) => {
    if (!canEdit) return errorResponse(createApiError('FORBIDDEN', '仅系统超管可以管理角色。'))
    if (operation !== 'create' && !isRoleId(roleId)) return errorResponse(createApiError('VALIDATION_ERROR'))

    let body: unknown
    try { body = await req.json() } catch { return errorResponse(createApiError('INVALID_JSON')) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse(createApiError('VALIDATION_ERROR'))
    const input = body as Record<string, unknown>
    const allowed = new Set(['expected_org_id'])
    if (operation !== 'create') allowed.add('expected_metadata_revision')
    if (operation !== 'archive') {
      allowed.add('name')
      allowed.add('description')
    }
    if (Object.keys(input).some(key => !allowed.has(key)) || !isRoleId(input.expected_org_id)) {
      return errorResponse(createApiError('VALIDATION_ERROR', '角色资料无效，请刷新后重试。'))
    }
    if (input.expected_org_id !== orgId) {
      return errorResponse(createApiError('CONFLICT', '当前组织已切换，请刷新后重试。', { reason: 'ORG_CHANGED' }))
    }

    const revision = input.expected_metadata_revision
    if (operation !== 'create' && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)) {
      return errorResponse(createApiError('VALIDATION_ERROR', '缺少当前角色版本，请刷新后重试。'))
    }
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const description = typeof input.description === 'string' ? input.description.trim() || null : null
    if (operation !== 'archive' && (!name || Array.from(name).length > 80
      || (input.description != null && typeof input.description !== 'string')
      || (description && Array.from(description).length > 300))) {
      return errorResponse(createApiError('VALIDATION_ERROR', '角色名称需为 1 至 80 字，说明最多 300 字。'))
    }

    const { data, error } = await supabaseAdmin.rpc('admin_mutate_org_role_v1', {
      p_org_id: orgId,
      p_actor_id: actorId,
      p_operation: operation,
      p_role_id: roleId ?? null,
      p_name: operation === 'archive' ? null : name,
      p_description: description,
      p_expected_revision: revision ?? null,
    }).single()
    if (error?.code === '42501') return errorResponse(createApiError('FORBIDDEN', '当前账号或角色不允许进行此操作。'))
    if (error && ['22023', '22P02'].includes(error.code)) return errorResponse(createApiError('VALIDATION_ERROR', '角色资料无效，请刷新后重试。'))
    if (error?.code === '23503') return errorResponse(createApiError('NOT_FOUND', '当前组织中找不到该角色。'))
    if (error?.code === '23505') return errorResponse(createApiError('DUPLICATE_KEY', '该组织已有同名角色。'))
    if (error?.code === '23514') return errorResponse(createApiError(
      'CONFLICT', '请先解除角色的成员分配、待生效授权和未完成的邀请。', { reason: 'ROLE_HAS_BINDINGS' },
    ))
    if (error?.code === '40001') return errorResponse(createApiError(
      'CONFLICT', '角色已被其他管理员更新，请刷新后重试。', { reason: 'ROLE_METADATA_CHANGED' },
    ))
    if (error || !data) return errorResponse(createApiError('DB_ERROR', '角色操作失败，请刷新后核对。'))
    return successResponse({ org_id: orgId, role: roleMetadata(data as OrgVisibleRole, operation !== 'archive') })
  })
}
