// REQ: F003 自主可控 + RBAC
// PURPOSE: 飞书组织架构同步
// 权限要求: 当前组织用户写 + 部门写权限

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgDepartments,
  canMutateOrgUsers,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import {
  ensureDefaultOrganizationMembership,
  syncPrimaryDepartmentMembership,
  syncUserSalesSpaces,
} from '@/lib/admin/org-membership'
import {
  loadOrganizationSources,
  OrganizationSourceError,
  recordOrganizationSourceSyncResult,
  selectPrimaryOrganizationSource,
  upsertExternalIdentity,
} from '@/lib/organization-sources'
import {
  loadVerifiedConnection,
  OrganizationConnectionError,
} from '@/lib/organization-connections'
import {
  addIdentityCandidate,
  buildIdentityIndex,
  normalizeIdentityEmail,
  normalizeIdentityPhone,
  resolveIdentityMatch,
  secondaryEnrichmentPatch,
  type IdentityCandidate,
} from '@/lib/organization-source-identity'

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
  employee_no?: string
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
const FEISHU_CONFIG_HINT = '请先在配置中心完成飞书连接草稿、通讯录预览验证，并显式确认主来源切换。飞书应用需要通讯录部门和成员读取权限。'

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
  return normalizeIdentityEmail(email)
}

function normalizePhone(phone: string | undefined) {
  return normalizeIdentityPhone(phone)
}

function roleCodeOf(value: unknown): string | null {
  const role = Array.isArray(value) ? value[0] : value
  if (!role || typeof role !== 'object') return null
  const code = (role as { code?: unknown }).code
  return typeof code === 'string' ? code : null
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

type ExistingUserRow = IdentityCandidate & {
  id: string
  status?: string | null
}

async function loadExistingUsers(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, phone, employee_id, display_name, title, avatar_url, status')
    .eq('org_id', orgId)

  if (error) {
    throw new Error('读取已有成员失败')
  }

  const profiles = new Map<string, ExistingUserRow>()
  const candidates = (data || []).map((row) => {
    const candidate: ExistingUserRow = {
      id: String(row.id),
      employeeId: row.employee_id ? String(row.employee_id) : null,
      email: row.email ? String(row.email) : null,
      phone: row.phone ? String(row.phone) : null,
      displayName: row.display_name ? String(row.display_name) : null,
      title: row.title ? String(row.title) : null,
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      status: row.status ? String(row.status) : null,
    }
    profiles.set(candidate.id, candidate)
    return candidate
  })

  return {
    index: buildIdentityIndex(candidates),
    profiles,
  }
}

async function loadProtectedSuperAdminUserIds(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('user_id, role:roles(code)')
    .eq('scope_type', 'org')
    .eq('scope_id', orgId)

  if (error) {
    throw new Error('读取受保护根管理员失败')
  }

  return new Set((data || [])
    .filter((row) => roleCodeOf(row.role) === 'SUPER_ADMIN')
    .map((row) => row.user_id as string)
    .filter(Boolean))
}

async function reconcileAuthoritativeDepartures(input: {
  orgId: string
  sourceId: string
  actorId: string
  incomingExternalIds: Set<string>
}) {
  const { data, error } = await supabaseAdmin
    .from('external_identities')
    .select('external_user_id, canonical_user_id')
    .eq('source_id', input.sourceId)
    .eq('system_org_id', input.orgId)
    .eq('match_status', 'matched')

  if (error) {
    return {
      offboarded: 0,
      failed: 1,
      warnings: [{
        scope: 'members' as const,
        sourceId: 'departure_reconciliation',
        message: '无法读取权威来源身份台账，未执行离职协调',
      }],
    }
  }

  const protectedUserIds = await loadProtectedSuperAdminUserIds(input.orgId)
  const missing = (data || []).filter((row) => (
    typeof row.external_user_id === 'string'
    && typeof row.canonical_user_id === 'string'
    && !input.incomingExternalIds.has(row.external_user_id)
    && !protectedUserIds.has(row.canonical_user_id)
    && row.canonical_user_id !== input.actorId
  ))
  let offboarded = 0
  let failed = 0
  const warnings: SyncWarning[] = []

  for (const row of missing) {
    const userId = row.canonical_user_id as string
    const { data: applied, error: offboardError } = await supabaseAdmin.rpc(
      'admin_offboard_member_v1',
      {
        p_actor_id: input.actorId,
        p_org_id: input.orgId,
        p_user_id: userId,
        p_reason: 'authoritative organization source departure',
        p_request_id: `feishu-source-reconcile:${row.external_user_id}`,
      },
    )
    if (offboardError || applied !== true) {
      failed += 1
      warnings.push({
        scope: 'members',
        sourceId: String(row.external_user_id),
        message: offboardError?.message || '来源成员离职处理失败',
      })
      continue
    }
    offboarded += 1
    await supabaseAdmin
      .from('external_identities')
      .update({
        match_status: 'ignored',
        profile_snapshot: {
          departure_observed_at: new Date().toISOString(),
          departure_reason: 'authoritative organization source departure',
        },
        updated_at: new Date().toISOString(),
      })
      .eq('source_id', input.sourceId)
      .eq('external_user_id', row.external_user_id)
  }

  return { offboarded, failed, warnings }
}

async function syncUsersToDatabase(
  orgId: string,
  sourceId: string,
  users: FeishuUserWithSource[],
  syncedDepartments: Map<string, SyncedDepartment>
) {
  const existing = await loadExistingUsers(orgId)
  const protectedSuperAdminUserIds = await loadProtectedSuperAdminUserIds(orgId)
  let imported = 0
  let updated = 0
  let skipped = 0
  const warnings: SyncWarning[] = []

  for (const feishuUser of users) {
    const externalId = externalUserId(feishuUser)
    const employeeId = feishuUser.employee_no?.trim() || externalId
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

    const resolution = resolveIdentityMatch(existing.index, {
      employeeId,
      email,
      phone,
    })
    if (resolution.kind === 'conflict') {
      skipped += 1
      warnings.push({
        scope: 'members',
        sourceId: externalId,
        message: `权威来源身份命中多个成员，已保留冲突：${resolution.candidateIds.join(',')}`,
      })
      await upsertExternalIdentity({
        sourceId,
        systemOrgId: orgId,
        externalUserId: externalId,
        externalUnionId: feishuUser.union_id || null,
        externalOpenId: feishuUser.open_id || null,
        canonicalUserId: null,
        matchStatus: 'conflict',
        matchMethod: 'none',
        matchConfidence: 0,
        profileSnapshot: {
          name: userDisplayName(feishuUser),
          email,
          mobile: phone,
          candidateUserIds: resolution.candidateIds,
        },
      })
      continue
    }

    const matchedId = resolution.kind === 'unique' ? resolution.userId : null
    const matchMethod = resolution.kind === 'unique' ? resolution.method : 'none'
    if (matchedId && protectedSuperAdminUserIds.has(matchedId)) {
      skipped += 1
      continue
    }

    const primaryDeptId = departmentIds[0]
    const avatarUrl = feishuUser.avatar?.avatar_72 || feishuUser.avatar?.avatar_url || null
    const profilePayload = {
      org_id: orgId,
      employee_id: employeeId,
      display_name: userDisplayName(feishuUser),
      primary_dept_id: primaryDeptId,
      updated_at: new Date().toISOString(),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      ...(feishuUser.job_title ? { title: feishuUser.job_title } : {}),
    }

    let userId = matchedId
    if (userId) {
      const { error } = await supabaseAdmin
        .from('users')
        .update(profilePayload)
        .eq('id', userId)
        .eq('org_id', orgId)
      if (error) {
        throw new Error(`更新飞书成员失败：${userDisplayName(feishuUser)}`)
      }
      updated += 1
    } else {
      const { data, error } = await supabaseAdmin
        .from('users')
        .insert({
          ...profilePayload,
          status: 'active',
        })
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
    await syncPrimaryDepartmentMembership(syncedUserId, primaryDeptId, orgId)
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

    addIdentityCandidate(existing.index, {
      id: syncedUserId,
      employeeId,
      email,
      phone,
      displayName: userDisplayName(feishuUser),
      title: feishuUser.job_title || null,
      avatarUrl,
    })

    await upsertExternalIdentity({
      sourceId,
      systemOrgId: orgId,
      externalUserId: externalId,
      externalUnionId: feishuUser.union_id || null,
      externalOpenId: feishuUser.open_id || null,
      canonicalUserId: syncedUserId,
      matchStatus: 'matched',
      matchMethod,
      matchConfidence: matchMethod === 'none' ? 0.5 : 1,
      profileSnapshot: {
        name: userDisplayName(feishuUser),
        email,
        mobile: phone,
        jobTitle: feishuUser.job_title || null,
        departmentExternalIds,
        avatarUrl,
      },
    })
  }

  return { imported, updated, skipped, total: users.length, warnings }
}

async function syncEnrichmentUsersToDatabase(
  orgId: string,
  sourceId: string,
  users: FeishuUserWithSource[],
) {
  const existing = await loadExistingUsers(orgId)
  const protectedSuperAdminUserIds = await loadProtectedSuperAdminUserIds(orgId)
  const warnings: SyncWarning[] = []
  let updated = 0
  let skipped = 0

  for (const feishuUser of users) {
    const externalId = externalUserId(feishuUser)
    const email = normalizeEmail(feishuUser.email)
    const phone = normalizePhone(feishuUser.mobile)
    const employeeId = feishuUser.employee_no?.trim() || null
    if (!externalId || (!employeeId && !email && !phone)) {
      skipped += 1
      continue
    }

    const resolution = resolveIdentityMatch(existing.index, {
      employeeId,
      email,
      phone,
    })
    const profileSnapshot = {
      name: userDisplayName(feishuUser),
      email,
      mobile: phone,
      employeeNo: employeeId,
      jobTitle: feishuUser.job_title || null,
      departmentExternalIds: Array.from(new Set([
        ...(feishuUser.department_ids || []),
        ...(feishuUser.departments || []),
        feishuUser.sourceDepartmentId,
      ].filter(Boolean))),
    }

    if (resolution.kind === 'none') {
      skipped += 1
      warnings.push({
        scope: 'members',
        sourceId: externalId,
        message: '补充来源成员未命中唯一既有成员，已保留为未解析身份',
      })
      await upsertExternalIdentity({
        sourceId,
        systemOrgId: orgId,
        externalUserId: externalId,
        externalUnionId: feishuUser.union_id || null,
        externalOpenId: feishuUser.open_id || null,
        canonicalUserId: null,
        matchStatus: 'unresolved',
        matchMethod: 'none',
        matchConfidence: 0,
        profileSnapshot,
      })
      continue
    }

    if (resolution.kind === 'conflict') {
      skipped += 1
      warnings.push({
        scope: 'members',
        sourceId: externalId,
        message: `补充来源身份命中多个成员，已保留冲突：${resolution.candidateIds.join(',')}`,
      })
      await upsertExternalIdentity({
        sourceId,
        systemOrgId: orgId,
        externalUserId: externalId,
        externalUnionId: feishuUser.union_id || null,
        externalOpenId: feishuUser.open_id || null,
        canonicalUserId: null,
        matchStatus: 'conflict',
        matchMethod: 'none',
        matchConfidence: 0,
        profileSnapshot: {
          ...profileSnapshot,
          candidateUserIds: resolution.candidateIds,
        },
      })
      continue
    }

    if (protectedSuperAdminUserIds.has(resolution.userId)) {
      skipped += 1
      continue
    }

    const profile = existing.profiles.get(resolution.userId)
    if (!profile) {
      skipped += 1
      warnings.push({
        scope: 'members',
        sourceId: externalId,
        message: '补充来源命中成员但成员资料不可用，未执行写入',
      })
      continue
    }

    const patch = secondaryEnrichmentPatch(profile, {
      email,
      phone,
      title: feishuUser.job_title || null,
      avatarUrl: feishuUser.avatar?.avatar_72 || feishuUser.avatar?.avatar_url || null,
    })
    if (Object.keys(patch).length > 0) {
      const { error } = await supabaseAdmin
        .from('users')
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
        })
        .eq('id', resolution.userId)
        .eq('org_id', orgId)
      if (error) {
        throw new Error(`补充飞书成员资料失败：${userDisplayName(feishuUser)}`)
      }
      updated += 1
    } else {
      skipped += 1
    }

    addIdentityCandidate(existing.index, {
      ...profile,
      email: patch.email || profile.email,
      phone: patch.phone || profile.phone,
      title: patch.title || profile.title,
      avatarUrl: patch.avatar_url || profile.avatarUrl,
    })
    await upsertExternalIdentity({
      sourceId,
      systemOrgId: orgId,
      externalUserId: externalId,
      externalUnionId: feishuUser.union_id || null,
      externalOpenId: feishuUser.open_id || null,
      canonicalUserId: resolution.userId,
      matchStatus: 'matched',
      matchMethod: resolution.method,
      matchConfidence: resolution.method === 'employee_id' ? 1 : 0.95,
      profileSnapshot,
    })
  }

  return {
    imported: 0,
    updated,
    skipped,
    total: users.length,
    warnings,
  }
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

  const orgId = await getFreshDefaultOrgId(user.id)
  const assignments = await getFreshUserScopedRoleAssignments(user.id)
  const canWriteUsers = canMutateOrgUsers(assignments, orgId)
  const canWriteDepartments = canMutateOrgDepartments(assignments, orgId)

  let primarySource
  try {
    primarySource = selectPrimaryOrganizationSource(await loadOrganizationSources(orgId))
  } catch (error) {
    return NextResponse.json(
      {
        code: 'FEISHU_SOURCE_REQUIRED',
        connector: FEISHU_CONNECTOR,
        scope: FEISHU_SYNC_SCOPE,
        error: error instanceof OrganizationSourceError ? error.message : '飞书组织来源不可用',
        hint: FEISHU_CONFIG_HINT,
      },
      { status: error instanceof OrganizationSourceError && error.status === 503 ? 503 : 409 },
    )
  }

  if (primarySource.provider !== 'feishu' || primarySource.syncMode !== 'authoritative') {
    return NextResponse.json(
      {
        code: 'FEISHU_SOURCE_INVALID',
        connector: FEISHU_CONNECTOR,
        scope: FEISHU_SYNC_SCOPE,
        error: '当前主组织来源不是已验证的飞书权威来源',
        hint: FEISHU_CONFIG_HINT,
      },
      { status: 409 },
    )
  }

  const sourcePriority = primarySource.priority
  const writesDepartments = sourcePriority === 1
  if (!canWriteUsers || (writesDepartments && !canWriteDepartments)) {
    return NextResponse.json(
      {
        code: 'FORBIDDEN',
        error: writesDepartments
          ? '需要当前组织的用户写和部门写权限'
          : '需要当前组织的用户写权限',
      },
      { status: 403 }
    )
  }

  const sourceId = primarySource.id
  let verifiedConnection
  try {
    verifiedConnection = await loadVerifiedConnection({
      orgId,
      provider: 'feishu',
      sourceId,
    })
  } catch (error) {
    return NextResponse.json(
      {
        code: error instanceof OrganizationConnectionError ? error.code : 'FEISHU_CONNECTION_NOT_VERIFIED',
        connector: FEISHU_CONNECTOR,
        scope: FEISHU_SYNC_SCOPE,
        error: error instanceof Error ? error.message : '飞书连接尚未验证',
        hint: FEISHU_CONFIG_HINT,
      },
      { status: error instanceof OrganizationConnectionError ? error.status : 409 },
    )
  }
  const connectionCredentials = verifiedConnection.credentials as { appId: string; appSecret: string }
  const appId = connectionCredentials.appId
  const appSecret = connectionCredentials.appSecret

  let token: string
  let departmentResult: Awaited<ReturnType<typeof fetchFeishuDepartments>>
  let departmentWrite: Awaited<ReturnType<typeof syncDepartmentsToDatabase>> = {
    imported: 0,
    updated: 0,
    synced: new Map(),
  }

  try {
    token = await getTenantAccessToken(appId, appSecret)
    departmentResult = await fetchFeishuDepartments(token)
    if (sourcePriority === 1) {
      departmentWrite = await syncDepartmentsToDatabase(orgId, departmentResult.departments)
    }
  } catch (error) {
    if (primarySource) {
      await recordOrganizationSourceSyncResult({
        systemOrgId: orgId,
        sourceId: primarySource.id,
        error: error instanceof Error ? error.message : '飞书部门同步失败',
      })
    }
    console.error('[FeishuSync] department phase failed:', error)
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

  let userResult: Awaited<ReturnType<typeof fetchFeishuUsers>> | null = null
  try {
    userResult = await fetchFeishuUsers(token, departmentResult.departments)
    const userWrite = sourcePriority === 1
      ? await syncUsersToDatabase(
          orgId,
          sourceId,
          userResult.users,
          departmentWrite.synced,
        )
      : await syncEnrichmentUsersToDatabase(
          orgId,
          sourceId,
          userResult.users,
        )
    const warnings = [
      ...departmentResult.warnings,
      ...userResult.warnings,
      ...userWrite.warnings,
    ]
    const canReconcileDepartures = sourcePriority === 1
      && departmentResult.warnings.length === 0
      && userResult.warnings.length === 0
      && userWrite.skipped === 0
      && departmentResult.departments.length > 0
    const departureReconciliation = canReconcileDepartures
      ? await reconcileAuthoritativeDepartures({
          orgId,
          sourceId,
          actorId: user.id,
          incomingExternalIds: new Set(
            userResult.users
              .map((member) => externalUserId(member))
              .filter(Boolean),
          ),
        })
      : { offboarded: 0, failed: 0, warnings: [] }
    warnings.push(...departureReconciliation.warnings)
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
    if (primarySource) {
      await recordOrganizationSourceSyncResult({
        systemOrgId: orgId,
        sourceId: primarySource.id,
        error: warnings.length > 0 ? `${warnings.length} 条同步警告` : null,
      })
    }

    return NextResponse.json({
      success: syncStatus === 'completed',
      connector: FEISHU_CONNECTOR,
      scope: FEISHU_SYNC_SCOPE,
      sync_status: syncStatus,
      source_authority: sourcePriority === 1 ? 'authoritative' : 'enrichment',
      organization_structure_written: sourcePriority === 1,
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
        offboarded_from_source: departureReconciliation.offboarded,
        departure_failed: departureReconciliation.failed,
      },
      warnings,
      message: departmentResult.departments.length === 0
        ? '飞书返回 0 个可访问部门'
        : syncStatus === 'partial'
          ? sourcePriority === 1
            ? '飞书组织架构部分同步完成'
            : '飞书补充身份资料部分同步完成'
          : sourcePriority === 1
            ? '飞书组织架构同步完成'
            : '飞书补充身份资料同步完成',
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '成员数据库写入失败'
    const failedAt = userResult === null ? 'upstream_fetch' : 'database_write'
    const warnings: SyncWarning[] = [
      ...departmentResult.warnings,
      ...(userResult?.warnings || []),
      {
        scope: 'members',
        sourceId: failedAt,
        message: errorMessage,
      },
    ]
    const departmentFailed = departmentResult.warnings
      .filter((warning) => warning.scope === 'departments').length

    if (primarySource) {
      await recordOrganizationSourceSyncResult({
        systemOrgId: orgId,
        sourceId: primarySource.id,
        error: errorMessage,
      })
    }
    console.error('[FeishuSync] member phase failed after department phase:', error)
    return NextResponse.json(
      {
        success: false,
        code: 'FEISHU_MEMBER_SYNC_PARTIAL',
        connector: FEISHU_CONNECTOR,
        scope: FEISHU_SYNC_SCOPE,
        sync_status: 'partial',
        source_authority: sourcePriority === 1 ? 'authoritative' : 'enrichment',
        organization_structure_written: sourcePriority === 1,
        departments: {
          imported: departmentWrite.imported,
          updated: departmentWrite.updated,
          failed: departmentFailed,
          total: departmentResult.departments.length,
        },
        members: {
          status: 'unknown',
          completed: false,
          candidate_count: userResult?.users.length ?? 0,
          failed: 1,
          failed_at: failedAt,
          offboarded_from_source: 0,
          departure_failed: 0,
        },
        warnings,
        error: errorMessage,
        message: sourcePriority === 1
          ? '飞书部门已提交，成员同步未完成'
          : '飞书补充来源成员同步未完成；组织层级未写入',
      },
      { status: 200 }
    )
  }
}
