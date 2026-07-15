import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { supabaseAdmin } from '@/lib/supabase'

export function createAdminTempPassword(): string {
  return `Cyan!${randomBytes(9).toString('base64url')}`
}

export async function hashAdminPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function assertDepartmentInOrg(orgId: string, departmentId: string | null | undefined) {
  if (!departmentId) {
    return null
  }

  const { data, error } = await supabaseAdmin
    .from('departments')
    .select('id, parent_id, path')
    .eq('id', departmentId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return data
}

export async function ensureDefaultOrganizationMembership(userId: string, orgId: string) {
  const { error } = await supabaseAdmin
    .from('user_organizations')
    .upsert(
      {
        user_id: userId,
        org_id: orgId,
        is_default: true,
      },
      { onConflict: 'user_id,org_id' }
    )

  if (error) {
    throw new Error('USER_ORG_LINK_FAILED')
  }
}

export async function syncPrimaryDepartmentMembership(
  userId: string,
  primaryDeptId: string | null,
  expectedOrgId?: string
) {
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, org_id, primary_dept_id')
    .eq('id', userId)
    .maybeSingle()

  if (userError || !user) {
    throw new Error('PRIMARY_DEPARTMENT_USER_NOT_FOUND')
  }

  const authoritativeOrgId = user.org_id as string
  const authoritativePrimaryDeptId = (user.primary_dept_id as string | null) || null
  if (expectedOrgId && expectedOrgId !== authoritativeOrgId) {
    throw new Error('PRIMARY_DEPARTMENT_ORG_MISMATCH')
  }
  if (authoritativePrimaryDeptId !== primaryDeptId) {
    throw new Error('PRIMARY_DEPARTMENT_STATE_MISMATCH')
  }

  if (primaryDeptId) {
    const targetDepartment = await assertDepartmentInOrg(authoritativeOrgId, primaryDeptId)
    if (!targetDepartment) {
      throw new Error('PRIMARY_DEPARTMENT_INVALID')
    }
  }

  const { data: primaryMemberships, error: membershipError } = await supabaseAdmin
    .from('user_departments')
    .select('department_id')
    .eq('user_id', userId)
    .eq('is_primary', true)

  if (membershipError) {
    throw new Error('PRIMARY_DEPARTMENT_SYNC_FAILED')
  }

  const primaryDepartmentIds = Array.from(new Set(
    (primaryMemberships || [])
      .map((membership) => membership.department_id as string | null)
      .filter((departmentId): departmentId is string => Boolean(departmentId))
  ))

  let currentOrgPrimaryIds: string[] = []
  if (primaryDepartmentIds.length > 0) {
    const { data: currentOrgDepartments, error: departmentError } = await supabaseAdmin
      .from('departments')
      .select('id')
      .eq('org_id', authoritativeOrgId)
      .in('id', primaryDepartmentIds)

    if (departmentError) {
      throw new Error('PRIMARY_DEPARTMENT_SYNC_FAILED')
    }

    currentOrgPrimaryIds = (currentOrgDepartments || [])
      .map((department) => department.id as string)
      .filter((departmentId) => departmentId !== primaryDeptId)
  }

  if (currentOrgPrimaryIds.length > 0) {
    const { error: deleteError } = await supabaseAdmin
      .from('user_departments')
      .delete()
      .eq('user_id', userId)
      .eq('is_primary', true)
      .in('department_id', currentOrgPrimaryIds)

    if (deleteError) {
      throw new Error('PRIMARY_DEPARTMENT_SYNC_FAILED')
    }
  }

  if (!primaryDeptId) {
    return
  }

  const { error } = await supabaseAdmin
    .from('user_departments')
    .upsert(
      {
        user_id: userId,
        department_id: primaryDeptId,
        is_primary: true,
      },
      { onConflict: 'user_id,department_id' }
    )

  if (error) {
    throw new Error('PRIMARY_DEPARTMENT_SYNC_FAILED')
  }
}

export async function syncUserSalesSpaces(userId: string, orgId: string, primaryDeptId: string | null) {
  if (!primaryDeptId) {
    return
  }

  const departmentIds: string[] = []
  let cursor: string | null = primaryDeptId
  let safety = 0

  while (cursor && safety < 12) {
    safety += 1
    const departmentResult = await supabaseAdmin
      .from('departments')
      .select('id, parent_id')
      .eq('id', cursor)
      .eq('org_id', orgId)
      .maybeSingle()
    const department = departmentResult.data as { id: string; parent_id: string | null } | null

    if (!department) {
      break
    }

    departmentIds.push(department.id)
    cursor = department.parent_id
  }

  if (departmentIds.length === 0) {
    return
  }

  const { data: spaces } = await supabaseAdmin
    .from('sales_spaces')
    .select('id')
    .eq('org_id', orgId)
    .in('department_id', departmentIds)

  const targetSpaceIds = (spaces || []).map((space) => space.id)
  if (targetSpaceIds.length === 0) {
    return
  }

  const { data: existing } = await supabaseAdmin
    .from('sales_space_members')
    .select('space_id')
    .eq('user_id', userId)
    .in('space_id', targetSpaceIds)

  const existingIds = new Set((existing || []).map((row) => row.space_id))
  const missingIds = targetSpaceIds.filter((spaceId) => !existingIds.has(spaceId))

  if (missingIds.length === 0) {
    return
  }

  const { error } = await supabaseAdmin
    .from('sales_space_members')
    .insert(missingIds.map((spaceId) => ({
      space_id: spaceId,
      user_id: userId,
      space_role: 'MEMBER',
    })))

  if (error) {
    throw new Error('SPACE_MEMBER_SYNC_FAILED')
  }
}

export async function replaceOrgRoleIds(userId: string, orgId: string, roleIds: string[], grantedBy: string) {
  const uniqueRoleIds = Array.from(new Set(roleIds.filter(Boolean)))

  const { data: validRoles, error: roleCheckError } = uniqueRoleIds.length > 0
    ? await supabaseAdmin
      .from('roles')
      .select('id')
      .in('id', uniqueRoleIds)
    : { data: [], error: null }

  if (roleCheckError) {
    throw new Error('ROLE_VALIDATE_FAILED')
  }

  const validRoleIds = (validRoles || []).map((role) => role.id)
  if (validRoleIds.length !== uniqueRoleIds.length) {
    throw new Error('ROLE_NOT_FOUND')
  }

  const { error: deleteError } = await supabaseAdmin
    .from('user_roles')
    .delete()
    .eq('user_id', userId)
    .eq('scope_type', 'org')
    .eq('scope_id', orgId)

  if (deleteError) {
    throw new Error('ROLE_ASSIGN_FAILED')
  }

  if (validRoleIds.length === 0) {
    return []
  }

  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .insert(validRoleIds.map((roleId) => ({
      user_id: userId,
      role_id: roleId,
      scope_type: 'org',
      scope_id: orgId,
      granted_by: grantedBy,
    })))
    .select(`
      role_id,
      role:role_id(id, name, code),
      scope_type,
      scope_id
    `)

  if (error) {
    throw new Error('ROLE_ASSIGN_FAILED')
  }

  return data || []
}
