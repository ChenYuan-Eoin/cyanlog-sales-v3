import {
  loadOrgRolePermissionSnapshot, RolePermissionRequestError, type ConfigRoleRecord,
} from '@/lib/org-role-permission-readback'
import { FXIAOKE_BASELINE_ROLE_CODE, ORG_SUPER_ADMIN_ROLE_CODE } from '@/lib/role-permission-resolution'

type RoleMetadataFields = { name: string; description: string }
type RoleMetadataTarget = { roleId: string; expectedRevision: number }
export type RoleMetadataChange =
  | ({ type: 'create' } & RoleMetadataFields)
  | ({ type: 'rename' } & RoleMetadataTarget & RoleMetadataFields)
  | ({ type: 'archive' } & RoleMetadataTarget)

export function isRoleMetadataEditable(role: ConfigRoleRecord) {
  return role.metadata_editable !== false
    && !['SUPER_ADMIN', ORG_SUPER_ADMIN_ROLE_CODE, FXIAOKE_BASELINE_ROLE_CODE].includes(role.code)
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export async function saveAndReadRoleMetadata(headers: HeadersInit, orgId: string, change: RoleMetadataChange) {
  const requestHeaders = new Headers(headers)
  requestHeaders.set('Content-Type', 'application/json')
  const path = change.type === 'create' ? '/api/roles' : `/api/roles/${encodeURIComponent(change.roleId)}/metadata`
  const method = change.type === 'create' ? 'POST' : change.type === 'rename' ? 'PATCH' : 'DELETE'
  const response = await fetch(path, {
    method,
    headers: requestHeaders,
    body: JSON.stringify({
      expected_org_id: orgId,
      ...(change.type !== 'create' ? { expected_metadata_revision: change.expectedRevision } : {}),
      ...(change.type !== 'archive' ? { name: change.name, description: change.description } : {}),
    }),
  })
  const body = object(await response.json().catch(() => null))
  if (!response.ok) {
    const error = object(body?.error)
    const message = object(error?.details)?.reason === 'ROLE_HAS_BINDINGS'
      ? '此角色仍有成员或待生效绑定，请解除绑定后再归档。'
      : typeof error?.message === 'string' ? error.message : '角色维护失败，请重试。'
    throw new RolePermissionRequestError(message, response.status)
  }
  const result = object(body?.data)
  const role = object(result?.role)
  if (body?.success !== true || result?.org_id !== orgId || typeof role?.id !== 'string' || !role.id
    || (change.type !== 'create' && role.id !== change.roleId)) {
    throw new RolePermissionRequestError('无法确认本次角色维护，请刷新列表核对。', response.status, true)
  }

  let snapshot
  try {
    snapshot = await loadOrgRolePermissionSnapshot(headers, role.id)
  } catch (error) {
    throw new RolePermissionRequestError('角色维护已提交，暂未核实角色列表，请刷新后核对。',
      error instanceof RolePermissionRequestError ? error.status : 0, true)
  }
  const verifiedRole = snapshot.roles.length === 1 ? snapshot.roles[0] : null
  const verified = change.type === 'archive' ? snapshot.roles.length === 0 : (
    verifiedRole?.id === role.id && verifiedRole.code === role.code
    && verifiedRole.name === change.name && (verifiedRole.description ?? '') === change.description
    && (typeof role.metadata_revision !== 'number' || verifiedRole.metadata_revision === role.metadata_revision)
  )
  if (snapshot.orgId !== orgId || !verified) {
    throw new RolePermissionRequestError('角色列表回读与本次维护不一致，请刷新后核对。', 409, true)
  }
  return { roleId: role.id, role: verifiedRole, snapshot }
}
