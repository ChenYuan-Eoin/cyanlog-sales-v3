import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canManageOrg,
  getOrgRoleCodes,
  getUserScopedRoleAssignments,
  type ScopeType,
} from '@/lib/scoped-access'

type RoleLookup = {
  id: string
  code: string
  name: string
}

type DepartmentLink = { name?: string } | { name?: string }[] | null
type UserRoleLink = {
  scope_type?: ScopeType
  scope_id?: string | null
  granted_at?: string | null
  role: { id?: string; name?: string; code?: string } | { id?: string; name?: string; code?: string }[] | null
}

type OrgUserRow = {
  id: string
  email: string | null
  display_name: string
  title: string | null
  status: string
  must_change_password: boolean | null
  primary_dept_id: string | null
  primary_dept: DepartmentLink
  user_roles: UserRoleLink[] | null
}

type OrgDepartmentRow = {
  id: string
  name: string
  code: string | null
  depth: number | null
  member_count: number | null
  parent_id: string | null
}

type SalesSpaceRow = {
  id: string
  name: string
  description: string | null
  department_id: string
  owner_id: string | null
}

type OrgContext = {
  user: Awaited<ReturnType<typeof requireAuth>>
  orgId: string
  roleCodes: string[]
}

function errorResponse(message: string, status: number, code?: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, code, ...extra }, { status })
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

function createTempPassword() {
  return `Cyan!${randomBytes(9).toString('base64url')}`
}

async function requireOrgAdmin(req: NextRequest): Promise<OrgContext | null> {
  const user = await requireAuth(req)
  const assignments = await getUserScopedRoleAssignments(user.id)
  const roleCodes = getOrgRoleCodes(assignments)

  if (!canManageOrg(assignments)) {
    return null
  }

  const { data: userOrg, error: orgError } = await supabaseAdmin
    .from('user_organizations')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('is_default', true)
    .single()

  if (orgError || !userOrg?.org_id) {
    throw new Error('ORG_FETCH_FAILED')
  }

  return {
    user,
    orgId: userOrg.org_id,
    roleCodes,
  }
}

async function assertDepartmentInOrg(orgId: string, departmentId: string | null | undefined) {
  if (!departmentId) {
    return null
  }

  const { data: department, error } = await supabaseAdmin
    .from('departments')
    .select('id, parent_id, path')
    .eq('id', departmentId)
    .eq('org_id', orgId)
    .single()

  if (error || !department) {
    return null
  }

  return department
}

async function getRoleCatalog() {
  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('id, code, name')
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error('ROLES_CATALOG_FAILED')
  }

  return (data || []) as RoleLookup[]
}

async function replaceOrgRoles(userId: string, orgId: string, roleCodes: string[]) {
  const uniqueCodes = Array.from(new Set(roleCodes.map((code) => code.trim()).filter(Boolean)))
  const roleCatalog = await getRoleCatalog()
  const roleByCode = new Map(roleCatalog.map((role) => [role.code, role]))
  const selectedRoles = uniqueCodes.map((code) => roleByCode.get(code)).filter((role): role is RoleLookup => Boolean(role))

  await supabaseAdmin
    .from('user_roles')
    .delete()
    .eq('user_id', userId)
    .eq('scope_type', 'org')
    .eq('scope_id', orgId)

  if (selectedRoles.length === 0) {
    return
  }

  const { error } = await supabaseAdmin
    .from('user_roles')
    .insert(
      selectedRoles.map((role) => ({
        user_id: userId,
        role_id: role.id,
        scope_type: 'org',
        scope_id: orgId,
      }))
    )

  if (error) {
    throw new Error('ROLE_ASSIGN_FAILED')
  }
}

async function replaceScopedRoles(
  userId: string,
  orgId: string,
  scopeType: ScopeType,
  scopeId: string | null,
  roleCodes: string[]
) {
  const uniqueCodes = Array.from(new Set(roleCodes.map((code) => code.trim()).filter(Boolean)))
  const roleCatalog = await getRoleCatalog()
  const roleByCode = new Map(roleCatalog.map((role) => [role.code, role]))
  const selectedRoles = uniqueCodes.map((code) => roleByCode.get(code)).filter((role): role is RoleLookup => Boolean(role))

  let deleteQuery = supabaseAdmin
    .from('user_roles')
    .delete()
    .eq('user_id', userId)
    .eq('scope_type', scopeType)

  if (scopeType === 'org') {
    deleteQuery = deleteQuery.eq('scope_id', orgId)
  } else if (scopeId) {
    deleteQuery = deleteQuery.eq('scope_id', scopeId)
  }

  await deleteQuery

  if (selectedRoles.length === 0) {
    return
  }

  const effectiveScopeId = scopeType === 'org' ? orgId : scopeId
  const { error } = await supabaseAdmin
    .from('user_roles')
    .insert(
      selectedRoles.map((role) => ({
        user_id: userId,
        role_id: role.id,
        scope_type: scopeType,
        scope_id: effectiveScopeId,
      }))
    )

  if (error) {
    throw new Error('ROLE_ASSIGN_FAILED')
  }
}

async function clearUserRolesForOrg(userId: string, orgId: string) {
  const [departmentResult, spaceResult] = await Promise.all([
    supabaseAdmin
      .from('departments')
      .select('id')
      .eq('org_id', orgId),
    supabaseAdmin
      .from('sales_spaces')
      .select('id')
      .eq('org_id', orgId),
  ])

  if (departmentResult.error || spaceResult.error) {
    throw new Error('ROLE_SCOPE_CLEAR_FAILED')
  }

  const departmentIds = (departmentResult.data || []).map((row) => row.id)
  const spaceIds = (spaceResult.data || []).map((row) => row.id)

  await supabaseAdmin
    .from('user_roles')
    .delete()
    .eq('user_id', userId)
    .eq('scope_type', 'org')
    .eq('scope_id', orgId)

  if (departmentIds.length > 0) {
    await supabaseAdmin
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('scope_type', 'department')
      .in('scope_id', departmentIds)
  }

  if (spaceIds.length > 0) {
    await supabaseAdmin
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('scope_type', 'space')
      .in('scope_id', spaceIds)
  }
}

async function syncPrimaryDepartmentMembership(userId: string, primaryDeptId: string | null) {
  await supabaseAdmin
    .from('user_departments')
    .update({ is_primary: false })
    .eq('user_id', userId)

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

async function syncUserSalesSpaces(userId: string, orgId: string, primaryDeptId: string | null) {
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
      .single()

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

async function listOrgPayload(orgId: string) {
  const [usersResult, departmentsResult, rolesResult, orgResult, spacesResult] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('id, email, display_name, title, status, must_change_password, primary_dept_id, primary_dept:departments!primary_dept_id(name), user_roles:user_roles!user_roles_user_id_fkey(scope_type, scope_id, granted_at, role:roles(id, name, code))')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('departments')
      .select('id, name, code, depth, member_count, parent_id')
      .eq('org_id', orgId)
      .order('depth', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('roles')
      .select('id, code, name')
      .order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('organizations')
      .select('id, name, slug')
      .eq('id', orgId)
      .single(),
    supabaseAdmin
      .from('sales_spaces')
      .select('id, name, description, department_id, owner_id')
      .eq('org_id', orgId)
      .order('name', { ascending: true }),
  ])

  if (usersResult.error) {
    throw new Error('USERS_FETCH_FAILED')
  }
  if (departmentsResult.error) {
    throw new Error('DEPARTMENTS_FETCH_FAILED')
  }
  if (rolesResult.error) {
    throw new Error('ROLES_FETCH_FAILED')
  }
  if (orgResult.error) {
    throw new Error('ORG_FETCH_FAILED')
  }
  if (spacesResult.error) {
    throw new Error('SPACES_FETCH_FAILED')
  }

  const departmentNameById = new Map(
    ((departmentsResult.data || []) as OrgDepartmentRow[]).map((department) => [department.id, department.name])
  )

  const users = ((usersResult.data || []) as OrgUserRow[]).map((row) => {
    const primaryDept = unwrapOne(row.primary_dept)
    const roleEntries = (row.user_roles || [])
      .map((userRole) => {
        const role = unwrapOne(userRole.role)
        if (!role?.code || !role.name || !role.id) {
          return null
        }

        let scopeName = '组织'
        if (userRole.scope_type === 'department' && userRole.scope_id) {
          scopeName = departmentNameById.get(userRole.scope_id) || '部门'
        } else if (userRole.scope_type === 'space' && userRole.scope_id) {
          scopeName = ((spacesResult.data || []) as SalesSpaceRow[])
            .find((space) => space.id === userRole.scope_id)?.name || '销售空间'
        }

        return {
          roleId: role.id,
          roleName: role.name,
          roleCode: role.code,
          scopeType: userRole.scope_type || 'org',
          scopeId: userRole.scope_id || null,
          scopeName,
          grantedAt: userRole.granted_at || null,
        }
      })
      .filter((role): role is {
        roleId: string
        roleName: string
        roleCode: string
        scopeType: ScopeType
        scopeId: string | null
        scopeName: string
        grantedAt: string | null
      } => Boolean(role))

    return {
      id: row.id,
      email: row.email || '',
      display_name: row.display_name,
      title: row.title || '',
      primary_dept_id: row.primary_dept_id || null,
      primary_dept_name: primaryDept?.name || '-',
      role_names: roleEntries
        .map((role) => role.scopeType === 'org' ? role.roleName : `${role.roleName}(${role.scopeName})`)
        .join(', '),
      role_codes: roleEntries
        .filter((role) => role.scopeType === 'org')
        .map((role) => role.roleCode),
      scoped_roles: roleEntries,
      status: row.status,
      must_change_password: Boolean(row.must_change_password),
    }
  })

  const roles = (rolesResult.data || []).map((role) => ({
    id: role.id,
    code: role.code,
    name: role.name,
  }))

  const spaces = ((spacesResult.data || []) as SalesSpaceRow[]).map((space) => ({
    id: space.id,
    name: space.name,
    description: space.description,
    department_id: space.department_id,
    department_name: departmentNameById.get(space.department_id) || '',
    owner_id: space.owner_id,
  }))

  return {
    organization: orgResult.data,
    users,
    departments: ((departmentsResult.data || []) as OrgDepartmentRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      depth: row.depth || 0,
      member_count: row.member_count || 0,
      parent_id: row.parent_id,
      parent_name: row.parent_id ? (departmentNameById.get(row.parent_id) || null) : null,
    })),
    roles,
    spaces,
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireOrgAdmin(req)
    if (!auth) {
      return errorResponse('无权限访问组织管理', 403, 'FORBIDDEN')
    }

    return NextResponse.json(await listOrgPayload(auth.orgId))
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }

    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOrgAdmin(req)
    if (!auth) {
      return errorResponse('无权限访问组织管理', 403, 'FORBIDDEN')
    }

    const body = await req.json()
    const { type } = body as { type?: string }

    if (type === 'department') {
      const { name, code, parentId } = body as {
        name?: string
        code?: string | null
        parentId?: string | null
      }

      if (!name?.trim()) {
        return errorResponse('部门名称不能为空', 400, 'INVALID_DEPARTMENT_PAYLOAD')
      }

      if (parentId) {
        const parent = await assertDepartmentInOrg(auth.orgId, parentId)
        if (!parent) {
          return errorResponse('上级部门不存在', 400, 'INVALID_PARENT_DEPARTMENT')
        }
      }

      const { data: department, error } = await supabaseAdmin
        .from('departments')
        .insert({
          id: randomUUID(),
          org_id: auth.orgId,
          name: name.trim(),
          code: code?.trim() || null,
          parent_id: parentId || null,
          source: 'manual',
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (error || !department) {
        return errorResponse('创建部门失败', 500, 'DEPARTMENT_CREATE_FAILED')
      }

      return NextResponse.json({ ok: true, departmentId: department.id })
    }

    if (type === 'user') {
      const { email, displayName, title, primaryDeptId, roleCodes, status, upsert } = body as {
        email?: string
        displayName?: string
        title?: string | null
        primaryDeptId?: string | null
        roleCodes?: string[]
        status?: 'active' | 'inactive' | 'suspended'
        upsert?: boolean
      }

      if (!email?.trim() || !displayName?.trim()) {
        return errorResponse('成员邮箱和姓名不能为空', 400, 'INVALID_USER_PAYLOAD')
      }

      const department = await assertDepartmentInOrg(auth.orgId, primaryDeptId)
      if (primaryDeptId && !department) {
        return errorResponse('主部门不存在', 400, 'INVALID_PRIMARY_DEPARTMENT')
      }

      const normalizedEmail = email.trim().toLowerCase()
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('org_id', auth.orgId)
        .eq('email', normalizedEmail)
        .maybeSingle()

      if (existingUser && !upsert) {
        return errorResponse('该邮箱已存在', 409, 'USER_EXISTS')
      }

      if (existingUser) {
        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update({
            display_name: displayName.trim(),
            title: title?.trim() || null,
            primary_dept_id: primaryDeptId || null,
            status: status || 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingUser.id)
          .eq('org_id', auth.orgId)

        if (updateError) {
          return errorResponse('更新成员失败', 500, 'USER_UPDATE_FAILED')
        }

        await syncPrimaryDepartmentMembership(existingUser.id, primaryDeptId || null)
        await syncUserSalesSpaces(existingUser.id, auth.orgId, primaryDeptId || null)

        if (Array.isArray(roleCodes)) {
          await replaceOrgRoles(existingUser.id, auth.orgId, roleCodes)
        }

        return NextResponse.json({ ok: true, userId: existingUser.id, created: false })
      }

      const tempPassword = createTempPassword()
      const passwordHash = await bcrypt.hash(tempPassword, 12)
      const userId = randomUUID()

      const { error: insertUserError } = await supabaseAdmin
        .from('users')
        .insert({
          id: userId,
          org_id: auth.orgId,
          email: normalizedEmail,
          display_name: displayName.trim(),
          title: title?.trim() || null,
          password_hash: passwordHash,
          must_change_password: true,
          status: status || 'active',
          primary_dept_id: primaryDeptId || null,
        })

      if (insertUserError) {
        return errorResponse('创建成员失败', 500, 'USER_CREATE_FAILED')
      }

      const { error: orgLinkError } = await supabaseAdmin
        .from('user_organizations')
        .upsert({
          user_id: userId,
          org_id: auth.orgId,
          is_default: true,
        }, { onConflict: 'user_id,org_id' })

      if (orgLinkError) {
        return errorResponse('关联组织失败', 500, 'USER_ORG_LINK_FAILED')
      }

      await syncPrimaryDepartmentMembership(userId, primaryDeptId || null)
      await syncUserSalesSpaces(userId, auth.orgId, primaryDeptId || null)

      if (Array.isArray(roleCodes) && roleCodes.length > 0) {
        await replaceOrgRoles(userId, auth.orgId, roleCodes)
      }

      return NextResponse.json({
        ok: true,
        userId,
        created: true,
        tempPassword,
      })
    }

    return errorResponse('不支持的操作类型', 400, 'UNSUPPORTED_TYPE')
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }

    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireOrgAdmin(req)
    if (!auth) {
      return errorResponse('无权限访问组织管理', 403, 'FORBIDDEN')
    }

    const body = await req.json()
    const { type } = body as { type?: string }

    if (type === 'department') {
      const { departmentId, name, parentId } = body as {
        departmentId?: string
        name?: string
        parentId?: string | null
      }

      if (!departmentId || !name?.trim()) {
        return errorResponse('部门参数不完整', 400, 'INVALID_DEPARTMENT_PAYLOAD')
      }

      const currentDepartment = await assertDepartmentInOrg(auth.orgId, departmentId)
      if (!currentDepartment) {
        return errorResponse('部门不存在', 404, 'DEPARTMENT_NOT_FOUND')
      }

      if (parentId === departmentId) {
        return errorResponse('部门不能挂到自己下面', 400, 'DEPARTMENT_PARENT_SELF')
      }

      if (parentId) {
        const parent = await assertDepartmentInOrg(auth.orgId, parentId)
        if (!parent) {
          return errorResponse('上级部门不存在', 400, 'INVALID_PARENT_DEPARTMENT')
        }
        if (parent.path?.includes(`/${departmentId}/`)) {
          return errorResponse('不能把部门挂到自己的下级下面', 400, 'DEPARTMENT_PARENT_CYCLE')
        }
      }

      const { error } = await supabaseAdmin
        .from('departments')
        .update({
          name: name.trim(),
          parent_id: parentId || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', departmentId)
        .eq('org_id', auth.orgId)

      if (error) {
        return errorResponse('更新部门失败', 500, 'DEPARTMENT_UPDATE_FAILED')
      }

      return NextResponse.json({ ok: true })
    }

    if (type === 'user') {
      const { userId, title, primaryDeptId, status } = body as {
        userId?: string
        title?: string | null
        primaryDeptId?: string | null
        status?: 'active' | 'inactive' | 'suspended'
      }

      if (!userId) {
        return errorResponse('成员参数不完整', 400, 'INVALID_USER_PAYLOAD')
      }

      if (primaryDeptId) {
        const department = await assertDepartmentInOrg(auth.orgId, primaryDeptId)
        if (!department) {
          return errorResponse('主部门不存在', 400, 'INVALID_PRIMARY_DEPARTMENT')
        }
      }

      const patch: Record<string, string | null> = {}
      if (typeof title !== 'undefined') patch.title = title?.trim() || null
      if (typeof primaryDeptId !== 'undefined') patch.primary_dept_id = primaryDeptId || null
      if (typeof status !== 'undefined') patch.status = status

      const { error } = await supabaseAdmin
        .from('users')
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .eq('org_id', auth.orgId)

      if (error) {
        return errorResponse('更新成员失败', 500, 'USER_UPDATE_FAILED')
      }

      if (typeof primaryDeptId !== 'undefined') {
        await syncPrimaryDepartmentMembership(userId, primaryDeptId || null)
        await syncUserSalesSpaces(userId, auth.orgId, primaryDeptId || null)
      }

      return NextResponse.json({ ok: true })
    }

    if (type === 'user_roles') {
      const { userId, roleCodes } = body as {
        userId?: string
        roleCodes?: string[]
      }

      if (!userId || !Array.isArray(roleCodes)) {
        return errorResponse('角色参数不完整', 400, 'INVALID_ROLE_PAYLOAD')
      }

      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', userId)
        .eq('org_id', auth.orgId)
        .maybeSingle()

      if (!userRow) {
        return errorResponse('成员不存在', 404, 'USER_NOT_FOUND')
      }

      await replaceOrgRoles(userId, auth.orgId, roleCodes)
      return NextResponse.json({ ok: true })
    }

    if (type === 'user_scoped_roles') {
      const { userId, assignments } = body as {
        userId?: string
        assignments?: Array<{
          scopeType: ScopeType
          scopeId?: string | null
          roleCodes: string[]
        }>
      }

      if (!userId || !Array.isArray(assignments)) {
        return errorResponse('角色参数不完整', 400, 'INVALID_ROLE_PAYLOAD')
      }

      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', userId)
        .eq('org_id', auth.orgId)
        .maybeSingle()

      if (!userRow) {
        return errorResponse('成员不存在', 404, 'USER_NOT_FOUND')
      }

      const normalizedAssignments = assignments
        .map((assignment) => ({
          scopeType: assignment.scopeType,
          scopeId: assignment.scopeType === 'org' ? auth.orgId : (assignment.scopeId || null),
          roleCodes: Array.from(new Set((assignment.roleCodes || []).map((code) => code.trim()).filter(Boolean))),
        }))
        .filter((assignment) => assignment.scopeType === 'org' || Boolean(assignment.scopeId))

      for (const assignment of assignments) {
        if (!assignment?.scopeType || !Array.isArray(assignment.roleCodes)) {
          return errorResponse('角色参数不完整', 400, 'INVALID_ROLE_PAYLOAD')
        }

        if (assignment.scopeType === 'department') {
          const department = await assertDepartmentInOrg(auth.orgId, assignment.scopeId)
          if (!department) {
            return errorResponse('部门不存在', 400, 'INVALID_SCOPE_DEPARTMENT')
          }
        }

        if (assignment.scopeType === 'space') {
          const { data: spaceRow } = await supabaseAdmin
            .from('sales_spaces')
            .select('id')
            .eq('id', assignment.scopeId)
            .eq('org_id', auth.orgId)
            .maybeSingle()

          if (!spaceRow) {
            return errorResponse('销售空间不存在', 400, 'INVALID_SCOPE_SPACE')
          }
        }
      }

      await clearUserRolesForOrg(userId, auth.orgId)

      for (const assignment of normalizedAssignments) {
        await replaceScopedRoles(
          userId,
          auth.orgId,
          assignment.scopeType,
          assignment.scopeId,
          assignment.roleCodes
        )
      }

      return NextResponse.json({ ok: true })
    }

    if (type === 'user_password_reset') {
      const { userId } = body as {
        userId?: string
      }

      if (!userId) {
        return errorResponse('成员参数不完整', 400, 'INVALID_USER_PAYLOAD')
      }

      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', userId)
        .eq('org_id', auth.orgId)
        .maybeSingle()

      if (!userRow) {
        return errorResponse('成员不存在', 404, 'USER_NOT_FOUND')
      }

      const tempPassword = createTempPassword()
      const passwordHash = await bcrypt.hash(tempPassword, 12)

      const { error } = await supabaseAdmin
        .from('users')
        .update({
          password_hash: passwordHash,
          must_change_password: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .eq('org_id', auth.orgId)

      if (error) {
        return errorResponse('重置密码失败', 500, 'PASSWORD_RESET_FAILED')
      }

      return NextResponse.json({
        ok: true,
        tempPassword,
      })
    }

    return errorResponse('不支持的操作类型', 400, 'UNSUPPORTED_TYPE')
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }

    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
