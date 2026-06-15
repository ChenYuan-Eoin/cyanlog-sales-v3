import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { cache } from 'react'
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
  sort_order?: number | null
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _DepartmentLink = { name?: string } | { name?: string }[] | null
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _UserRoleLink = {
  scope_type?: ScopeType
  scope_id?: string | null
  granted_at?: string | null
  role: { id?: string; name?: string; code?: string } | { id?: string; name?: string; code?: string }[] | null
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

// 兼容旧代码调用
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const unwrapOne = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

// 兼容旧代码调用
const createTempPassword = (): string => {
  return `Cyan!${randomBytes(9).toString('base64url')}`
}

// ============ 缓存层 - 数据不常变，缓存 5 分钟 ============

// 缓存 TTL 注释说明：react cache 自动处理缓存生命周期
// const CACHE_TTL_SECONDS = 300 // 5 分钟 - 保留作为文档

// 缓存部门列表查询
const getCachedDepartments = cache(async (orgId: string): Promise<OrgDepartmentRow[]> => {
  const { data, error } = await supabaseAdmin
    .from('departments')
    .select('id, name, code, depth, member_count, parent_id')
    .eq('org_id', orgId)
    .order('depth', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error('DEPARTMENTS_FETCH_FAILED')
  }

  return (data || []) as OrgDepartmentRow[]
})

// 缓存角色列表查询
const getCachedRoles = cache(async (): Promise<RoleLookup[]> => {
  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('id, code, name, sort_order')
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error('ROLES_FETCH_FAILED')
  }

  return (data || []) as RoleLookup[]
})

// 缓存销售空间列表查询
const getCachedSalesSpaces = cache(async (orgId: string): Promise<SalesSpaceRow[]> => {
  const { data, error } = await supabaseAdmin
    .from('sales_spaces')
    .select('id, name, description, department_id, owner_id')
    .eq('org_id', orgId)
    .order('name', { ascending: true })

  if (error) {
    throw new Error('SPACES_FETCH_FAILED')
  }

  return (data || []) as SalesSpaceRow[]
})

// 缓存组织信息查询
const getCachedOrganization = cache(async (orgId: string) => {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug')
    .eq('id', orgId)
    .single()

  if (error) {
    throw new Error('ORG_FETCH_FAILED')
  }

  return data
})

// 缓存用户角色查询
const getCachedUserRoles = cache(async (orgId: string) => {
  // 只查询当前组织的用户角色关联
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('user_id, scope_type, scope_id, granted_at, role:roles(id, name, code)')
    .eq('scope_type', 'org')
    .eq('scope_id', orgId)

  if (error) {
    throw new Error('USER_ROLES_FETCH_FAILED')
  }

  return data || []
})

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

// 优化后的列表查询 - 使用缓存和简化查询
async function listOrgPayload(orgId: string) {
  // 并行获取缓存数据（部门、角色、销售空间、组织信息）
  const [departments, roles, spaces, organization] = await Promise.all([
    getCachedDepartments(orgId),
    getCachedRoles(),
    getCachedSalesSpaces(orgId),
    getCachedOrganization(orgId),
  ])

  // 构建部门名称映射
  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]))
  const spaceNameById = new Map(spaces.map((s) => [s.id, s.name]))

  // 简化用户查询 - 不关联复杂角色数据，只获取基础信息
  const { data: usersData, error: usersError } = await supabaseAdmin
    .from('users')
    .select('id, email, display_name, title, status, must_change_password, primary_dept_id')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (usersError) {
    throw new Error('USERS_FETCH_FAILED')
  }

  // 获取用户角色关联（缓存）
  const userRolesData = await getCachedUserRoles(orgId)

  // 构建角色映射
  // 角色映射（预留，用于后续扩展）
  // const _roleById = new Map(roles.map((r) => [r.id, r]))

  // 构建用户角色映射
  const userRolesMap = new Map<string, typeof userRolesData>()
  for (const ur of userRolesData) {
    const userId = (ur as unknown as { user_id: string }).user_id
    if (!userRolesMap.has(userId)) {
      userRolesMap.set(userId, [])
    }
    userRolesMap.get(userId)!.push(ur)
  }

  // 处理用户数据
  const users = (usersData || []).map((row) => {
    const userRoleEntries = (userRolesMap.get(row.id) || [])
      .map((ur: unknown) => {
        const entry = ur as {
          scope_type: string
          scope_id: string | null
          granted_at: string | null
          role: { id: string; name: string; code: string } | null
        }
        const role = entry.role
        if (!role?.code) return null

        let scopeName = '组织'
        if (entry.scope_type === 'department' && entry.scope_id) {
          scopeName = departmentNameById.get(entry.scope_id) || '部门'
        } else if (entry.scope_type === 'space' && entry.scope_id) {
          scopeName = spaceNameById.get(entry.scope_id) || '销售空间'
        }

        return {
          roleId: role.id,
          roleName: role.name,
          roleCode: role.code,
          scopeType: entry.scope_type as ScopeType,
          scopeId: entry.scope_id,
          scopeName,
          grantedAt: entry.granted_at,
        }
      })
      .filter(Boolean) as {
        roleId: string
        roleName: string
        roleCode: string
        scopeType: ScopeType
        scopeId: string | null
        scopeName: string
        grantedAt: string | null
      }[]

    return {
      id: row.id,
      email: row.email || '',
      display_name: row.display_name,
      title: row.title || '',
      primary_dept_id: row.primary_dept_id,
      primary_dept_name: row.primary_dept_id
        ? departmentNameById.get(row.primary_dept_id) || '-'
        : '-',
      role_names: userRoleEntries
        .map((r) => (r.scopeType === 'org' ? r.roleName : `${r.roleName}(${r.scopeName})`))
        .join(', '),
      role_codes: userRoleEntries.filter((r) => r.scopeType === 'org').map((r) => r.roleCode),
      scoped_roles: userRoleEntries,
      status: row.status,
      must_change_password: Boolean(row.must_change_password),
    }
  })

  return {
    organization: organization,
    users,
    departments: departments.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      depth: row.depth || 0,
      member_count: row.member_count || 0,
      parent_id: row.parent_id,
      parent_name: row.parent_id ? departmentNameById.get(row.parent_id) || null : null,
    })),
    roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
    spaces: spaces.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      department_id: s.department_id,
      department_name: departmentNameById.get(s.department_id) || '',
      owner_id: s.owner_id,
    })),
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
