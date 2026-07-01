// REQ: F003 自主可控 + RBAC
// PURPOSE: 飞书组织架构同步
// 权限要求: 组织管理员（SUPER_ADMIN / SALES_OPS / ADMIN 或拥有 admin:access/org:write 权限）

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canManageOrg, getDefaultOrgId, getUserScopedRoleAssignments } from '@/lib/scoped-access'
import {
  ensureDefaultOrganizationMembership,
  syncPrimaryDepartmentMembership,
  syncUserSalesSpaces,
} from '@/lib/admin/org-membership'

type FeishuDepartment = {
  department_id?: string
  open_department_id?: string
  parent_department_id?: string
  name?: string
  i18n_name?: {
    zh_cn?: string
    en_us?: string
  }
  status?: {
    is_deleted?: boolean
  }
}

type FeishuUser = {
  user_id?: string
  open_id?: string
  union_id?: string
  name?: string
  en_name?: string
  email?: string
  mobile?: string
  department_ids?: string[]
  departments?: string[]
  job_title?: string
  avatar?: {
    avatar_72?: string
    avatar_url?: string
  }
  status?: {
    is_resigned?: boolean
    is_frozen?: boolean
  }
}

type FeishuUserWithSource = FeishuUser & {
  sourceDepartmentId: string
}

type SyncedDepartment = {
  id: string
  path: string
  depth: number
}

type SyncWarning = {
  scope: 'departments' | 'members'
  sourceId?: string
  message: string
}

const FEISHU_CONNECTOR = 'feishu'
const FEISHU_SYNC_SCOPE = 'departments_and_members'
const FEISHU_CONFIG_HINT = '请在 Vercel Production/Preview 环境变量和本地 .env.local 配置 FEISHU_APP_ID、FEISHU_APP_SECRET 后重新部署；飞书应用需要通讯录部门读取和成员读取权限。'

function externalDepartmentId(department: FeishuDepartment) {
  return department.department_id || department.open_department_id || ''
}

function departmentName(department: FeishuDepartment) {
  return department.name || department.i18n_name?.zh_cn || department.i18n_name?.en_us || externalDepartmentId(department)
}

function externalUserId(user: FeishuUser) {
  return user.user_id || user.open_id || user.union_id || user.email || user.mobile || ''
}

function userDisplayName(user: FeishuUser) {
  return user.name || user.en_name || user.email || user.mobile || externalUserId(user)
}

function normalizeEmail(email: string | undefined) {
  const trimmed = email?.trim().toLowerCase()
  return trimmed || null
}

function normalizePhone(phone: string | undefined) {
  const trimmed = phone?.replace(/\s+/g, '').trim()
  return trimmed || null
}

async function getTenantAccessToken(appId: string, appSecret: string) {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  })
  const data = await res.json().catch(() => null) as { code?: number; msg?: string; tenant_access_token?: string } | null

  if (!res.ok || data?.code !== 0 || !data.tenant_access_token) {
    throw new Error(data?.msg || '获取飞书 tenant_access_token 失败')
  }

  return data.tenant_access_token
}

async function fetchFeishuDepartmentChildren(token: string, parentDepartmentId: string) {
  const departments: FeishuDepartment[] = []
  let pageToken = ''

  do {
    const url = new URL(`https://open.feishu.cn/open-apis/contact/v3/departments/${encodeURIComponent(parentDepartmentId)}/children`)
    url.searchParams.set('department_id_type', 'department_id')
    url.searchParams.set('user_id_type', 'user_id')
    url.searchParams.set('page_size', '50')
    if (pageToken) {
      url.searchParams.set('page_token', pageToken)
    }

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await res.json().catch(() => null) as {
      code?: number
      msg?: string
      data?: {
        items?: FeishuDepartment[]
        has_more?: boolean
        page_token?: string
      }
    } | null

    if (!res.ok || data?.code !== 0) {
      throw new Error(data?.msg || `获取飞书部门子节点失败：${parentDepartmentId}`)
    }

    departments.push(...(data.data?.items || []).filter((department) => (
      !department.status?.is_deleted && Boolean(externalDepartmentId(department))
    )))
    pageToken = data.data?.has_more ? (data.data.page_token || '') : ''
  } while (pageToken)

  return departments
}

async function fetchFeishuDepartments(token: string) {
  const departments: FeishuDepartment[] = []
  const byExternalId = new Map<string, FeishuDepartment>()
  const warnings: SyncWarning[] = []
  const visited = new Set<string>()

  async function visit(parentDepartmentId: string, isRoot = false) {
    if (visited.has(parentDepartmentId)) return
    visited.add(parentDepartmentId)

    let children: FeishuDepartment[] = []
    try {
      children = await fetchFeishuDepartmentChildren(token, parentDepartmentId)
    } catch (error) {
      if (isRoot) {
        throw error
      }
      warnings.push({
        scope: 'departments',
        sourceId: parentDepartmentId,
        message: error instanceof Error ? error.message : '飞书子部门读取失败',
      })
      return
    }

    for (const department of children) {
      const externalId = externalDepartmentId(department)
      if (!externalId || byExternalId.has(externalId)) {
        continue
      }
      byExternalId.set(externalId, department)
      departments.push(department)
      await visit(externalId)
    }
  }

  await visit('0', true)

  return { departments, warnings }
}

async function fetchFeishuUsersByDepartment(token: string, departmentId: string) {
  const users: FeishuUser[] = []
  let pageToken = ''

  do {
    const url = new URL('https://open.feishu.cn/open-apis/contact/v3/users/find_by_department')
    url.searchParams.set('department_id', departmentId)
    url.searchParams.set('department_id_type', 'department_id')
    url.searchParams.set('user_id_type', 'user_id')
    url.searchParams.set('page_size', '50')
    if (pageToken) {
      url.searchParams.set('page_token', pageToken)
    }

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await res.json().catch(() => null) as {
      code?: number
      msg?: string
      data?: {
        items?: FeishuUser[]
        has_more?: boolean
        page_token?: string
      }
    } | null

    if (!res.ok || data?.code !== 0) {
      throw new Error(data?.msg || `获取飞书部门成员失败：${departmentId}`)
    }

    users.push(...(data.data?.items || []))
    pageToken = data.data?.has_more ? (data.data.page_token || '') : ''
  } while (pageToken)

  return users
}

async function fetchFeishuUsers(token: string, departments: FeishuDepartment[]) {
  const usersByExternalId = new Map<string, FeishuUserWithSource>()
  const warnings: SyncWarning[] = []
  const departmentIds = Array.from(new Set([
    '0',
    ...departments
      .map((department) => externalDepartmentId(department))
      .filter((departmentId): departmentId is string => Boolean(departmentId)),
  ]))

  for (const departmentId of departmentIds) {
    try {
      const users = await fetchFeishuUsersByDepartment(token, departmentId)
      for (const user of users) {
        if (user.status?.is_resigned || user.status?.is_frozen) {
          continue
        }
        const userId = externalUserId(user)
        if (!userId) {
          warnings.push({
            scope: 'members',
            sourceId: departmentId,
            message: '飞书成员缺少 user_id/open_id/email/mobile，已跳过',
          })
          continue
        }

        const existing = usersByExternalId.get(userId)
        const departmentIds = Array.from(new Set([
          ...(existing?.department_ids || []),
          ...(existing?.departments || []),
          ...(user.department_ids || []),
          ...(user.departments || []),
          departmentId,
        ]))

        usersByExternalId.set(userId, {
          ...existing,
          ...user,
          department_ids: departmentIds,
          sourceDepartmentId: existing?.sourceDepartmentId || departmentId,
        })
      }
    } catch (error) {
      warnings.push({
        scope: 'members',
        sourceId: departmentId,
        message: error instanceof Error ? error.message : '飞书成员读取失败',
      })
    }
  }

  return { users: Array.from(usersByExternalId.values()), warnings }
}

async function loadExistingFeishuDepartments(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('departments')
    .select('id, external_id, path, depth')
    .eq('org_id', orgId)
    .eq('source', 'feishu')

  if (error) {
    throw new Error('读取已有飞书部门失败')
  }

  return new Map((data || [])
    .filter((row) => row.external_id)
    .map((row) => [row.external_id as string, {
      id: row.id as string,
      path: (row.path as string | null) || `/${row.id}/`,
      depth: typeof row.depth === 'number' ? row.depth : 0,
    }]))
}

async function syncDepartmentsToDatabase(orgId: string, departments: FeishuDepartment[]) {
  const byExternalId = new Map(departments.map((department) => [externalDepartmentId(department), department]))
  const synced = await loadExistingFeishuDepartments(orgId)
  const pending = new Set(byExternalId.keys())
  let imported = 0
  let updated = 0
  let safety = 0

  while (pending.size > 0 && safety < departments.length + 5) {
    safety += 1
    let progressed = false

    for (const externalId of Array.from(pending)) {
      const department = byExternalId.get(externalId)
      if (!department) {
        pending.delete(externalId)
        continue
      }

      const parentExternalId = department.parent_department_id && department.parent_department_id !== '0'
        ? department.parent_department_id
        : null
      const parent = parentExternalId ? synced.get(parentExternalId) : null

      if (parentExternalId && !parent && byExternalId.has(parentExternalId)) {
        continue
      }

      const existing = synced.get(externalId)
      const parentId = parent?.id ?? null
      const depth = parent ? parent.depth + 1 : 0
      const basePayload = {
        org_id: orgId,
        parent_id: parentId,
        name: departmentName(department),
        code: externalId,
        source: 'feishu',
        external_id: externalId,
        status: 'active',
        depth,
        updated_at: new Date().toISOString(),
      }

      let rowId = existing?.id
      if (rowId) {
        const { error } = await supabaseAdmin
          .from('departments')
          .update(basePayload)
          .eq('id', rowId)
          .eq('org_id', orgId)
        if (error) {
          throw new Error(`更新飞书部门失败：${departmentName(department)}`)
        }
        updated += 1
      } else {
        const { data, error } = await supabaseAdmin
          .from('departments')
          .insert(basePayload)
          .select('id')
          .single()
        if (error || !data?.id) {
          throw new Error(`写入飞书部门失败：${departmentName(department)}`)
        }
        rowId = data.id
        imported += 1
      }

      if (!rowId) {
        throw new Error(`飞书部门缺少数据库记录：${departmentName(department)}`)
      }

      const path = parent ? `${parent.path}${rowId}/` : `/${rowId}/`
      const { error: pathError } = await supabaseAdmin
        .from('departments')
        .update({ path })
        .eq('id', rowId)
        .eq('org_id', orgId)
      if (pathError) {
        throw new Error(`更新飞书部门路径失败：${departmentName(department)}`)
      }

      synced.set(externalId, { id: rowId, path, depth } satisfies SyncedDepartment)
      pending.delete(externalId)
      progressed = true
    }

    if (!progressed) {
      throw new Error('飞书部门层级存在缺失父级或循环引用，无法完成同步')
    }
  }

  return { imported, updated, synced }
}

async function loadExistingUsers(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, phone, employee_id')
    .eq('org_id', orgId)

  if (error) {
    throw new Error('读取已有成员失败')
  }

  const byEmployeeId = new Map<string, { id: string }>()
  const byEmail = new Map<string, { id: string }>()
  const byPhone = new Map<string, { id: string }>()

  for (const row of data || []) {
    const user = { id: row.id as string }
    if (row.employee_id) byEmployeeId.set(String(row.employee_id), user)
    if (row.email) byEmail.set(String(row.email).toLowerCase(), user)
    if (row.phone) byPhone.set(String(row.phone).replace(/\s+/g, ''), user)
  }

  return { byEmployeeId, byEmail, byPhone }
}

async function syncUsersToDatabase(
  orgId: string,
  users: FeishuUserWithSource[],
  syncedDepartments: Map<string, SyncedDepartment>
) {
  const existing = await loadExistingUsers(orgId)
  let imported = 0
  let updated = 0
  let skipped = 0

  for (const feishuUser of users) {
    const externalId = externalUserId(feishuUser)
    const email = normalizeEmail(feishuUser.email)
    const phone = normalizePhone(feishuUser.mobile)
    const departmentExternalIds = Array.from(new Set([
      ...(feishuUser.department_ids || []),
      ...(feishuUser.departments || []),
      feishuUser.sourceDepartmentId,
    ].filter(Boolean)))
    const departmentIds = departmentExternalIds
      .map((departmentId) => syncedDepartments.get(departmentId)?.id)
      .filter((departmentId): departmentId is string => Boolean(departmentId))

    if (!externalId || departmentIds.length === 0 || (!email && !phone)) {
      skipped += 1
      continue
    }

    const matched = existing.byEmployeeId.get(externalId)
      || (email ? existing.byEmail.get(email) : null)
      || (phone ? existing.byPhone.get(phone) : null)
      || null
    const primaryDeptId = departmentIds[0]
    const avatarUrl = feishuUser.avatar?.avatar_72 || feishuUser.avatar?.avatar_url || null
    const payload = {
      org_id: orgId,
      employee_id: externalId,
      display_name: userDisplayName(feishuUser),
      primary_dept_id: primaryDeptId,
      status: 'active',
      updated_at: new Date().toISOString(),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      ...(feishuUser.job_title ? { title: feishuUser.job_title } : {}),
    }

    let userId = matched?.id
    if (userId) {
      const { error } = await supabaseAdmin
        .from('users')
        .update(payload)
        .eq('id', userId)
        .eq('org_id', orgId)
      if (error) {
        throw new Error(`更新飞书成员失败：${userDisplayName(feishuUser)}`)
      }
      updated += 1
    } else {
      const { data, error } = await supabaseAdmin
        .from('users')
        .insert(payload)
        .select('id')
        .single()
      if (error || !data?.id) {
        throw new Error(`写入飞书成员失败：${userDisplayName(feishuUser)}`)
      }
      userId = data.id
      imported += 1
    }

    if (!userId) {
      throw new Error(`飞书成员缺少数据库记录：${userDisplayName(feishuUser)}`)
    }

    const syncedUserId = userId
    await ensureDefaultOrganizationMembership(syncedUserId, orgId)
    await syncPrimaryDepartmentMembership(syncedUserId, primaryDeptId)
    await syncUserSalesSpaces(syncedUserId, orgId, primaryDeptId)

    const extraDepartmentRows = departmentIds
      .slice(1)
      .map((departmentId) => ({
        user_id: syncedUserId,
        department_id: departmentId,
        is_primary: false,
      }))
    if (extraDepartmentRows.length > 0) {
      const { error } = await supabaseAdmin
        .from('user_departments')
        .upsert(extraDepartmentRows, { onConflict: 'user_id,department_id' })
      if (error) {
        throw new Error(`写入飞书成员部门关系失败：${userDisplayName(feishuUser)}`)
      }
    }

    existing.byEmployeeId.set(externalId, { id: syncedUserId })
    if (email) existing.byEmail.set(email, { id: syncedUserId })
    if (phone) existing.byPhone.set(phone, { id: syncedUserId })
  }

  return { imported, updated, skipped, total: users.length }
}

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireAuth(req)
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return NextResponse.json(
        { code: 'UNAUTHORIZED', error: '未登录或登录已过期' },
        { status: 401 }
      )
    }
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', error: '服务器内部错误' },
      { status: 500 }
    )
  }

  const assignments = await getUserScopedRoleAssignments(user.id)

  if (!canManageOrg(assignments)) {
    return NextResponse.json(
      { code: 'FORBIDDEN', error: '需要组织管理员权限' },
      { status: 403 }
    )
  }

  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  if (!appId || !appSecret) {
    const missing = [
      !appId ? 'FEISHU_APP_ID' : null,
      !appSecret ? 'FEISHU_APP_SECRET' : null,
    ].filter(Boolean)

    return NextResponse.json(
      {
        code: 'FEISHU_NOT_CONFIGURED',
        connector: FEISHU_CONNECTOR,
        scope: FEISHU_SYNC_SCOPE,
        missing,
        error: `飞书同步未配置：缺少 ${missing.join(' / ')} 环境变量`,
        hint: FEISHU_CONFIG_HINT,
      },
      { status: 503 }
    )
  }

  try {
    const orgId = await getDefaultOrgId(user.id)
    const token = await getTenantAccessToken(appId, appSecret)
    const departmentResult = await fetchFeishuDepartments(token)
    const departmentWrite = await syncDepartmentsToDatabase(orgId, departmentResult.departments)
    const userResult = await fetchFeishuUsers(token, departmentResult.departments)
    const userWrite = await syncUsersToDatabase(orgId, userResult.users, departmentWrite.synced)
    const warnings = [...departmentResult.warnings, ...userResult.warnings]
    if (departmentResult.departments.length === 0) {
      warnings.push({
        scope: 'departments',
        sourceId: '0',
        message: '飞书只返回 root 或 0 个可访问部门；请检查通讯录部门读取权限和应用可见范围。',
      })
    }
    const syncStatus = warnings.length > 0 ? 'partial' : 'completed'
    const departmentFailed = warnings.filter((warning) => warning.scope === 'departments').length
    const memberFailed = warnings.filter((warning) => warning.scope === 'members').length

    return NextResponse.json({
      success: syncStatus === 'completed',
      connector: FEISHU_CONNECTOR,
      scope: FEISHU_SYNC_SCOPE,
      sync_status: syncStatus,
      departments: {
        imported: departmentWrite.imported,
        updated: departmentWrite.updated,
        failed: departmentFailed,
        total: departmentResult.departments.length,
      },
      members: {
        imported: userWrite.imported,
        updated: userWrite.updated,
        skipped: userWrite.skipped,
        failed: memberFailed,
        total: userWrite.total,
      },
      warnings,
      message: departmentResult.departments.length === 0
        ? '飞书返回 0 个可访问部门'
        : syncStatus === 'partial'
          ? '飞书组织架构部分同步完成'
          : '飞书组织架构同步完成',
    })
  } catch (error) {
    console.error('[FeishuSync] sync failed:', error)
    return NextResponse.json(
      {
        code: 'FEISHU_SYNC_FAILED',
        connector: FEISHU_CONNECTOR,
        scope: FEISHU_SYNC_SCOPE,
        error: error instanceof Error ? error.message : '飞书同步失败',
        hint: '请确认飞书应用已开通通讯录读取权限，并在 Vercel 函数日志中查看上游返回。',
      },
      { status: 502 }
    )
  }
}
