// REQ: F003 自主可控 + RBAC
// PURPOSE: 飞书部门结构同步
// 权限要求: 组织管理员（SUPER_ADMIN / SALES_OPS / ADMIN 或拥有 admin:access/org:write 权限）

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canManageOrg, getDefaultOrgId, getUserScopedRoleAssignments } from '@/lib/scoped-access'

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

type SyncedDepartment = {
  id: string
  path: string
  depth: number
}

const FEISHU_CONNECTOR = 'feishu'
const FEISHU_SYNC_SCOPE = 'departments'
const FEISHU_CONFIG_HINT = '请在 Vercel Production/Preview 环境变量和本地 .env.local 配置 FEISHU_APP_ID、FEISHU_APP_SECRET 后重新部署；当前 MVP 仅同步部门结构，不会导入成员。'

function externalDepartmentId(department: FeishuDepartment) {
  return department.department_id || department.open_department_id || ''
}

function departmentName(department: FeishuDepartment) {
  return department.name || department.i18n_name?.zh_cn || department.i18n_name?.en_us || externalDepartmentId(department)
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

async function fetchFeishuDepartments(token: string) {
  const departments: FeishuDepartment[] = []
  let pageToken = ''

  do {
    const url = new URL('https://open.feishu.cn/open-apis/contact/v3/departments')
    url.searchParams.set('department_id_type', 'department_id')
    url.searchParams.set('user_id_type', 'user_id')
    url.searchParams.set('page_size', '100')
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
      throw new Error(data?.msg || '获取飞书部门列表失败')
    }

    departments.push(...(data.data?.items || []).filter((department) => (
      !department.status?.is_deleted && Boolean(externalDepartmentId(department))
    )))
    pageToken = data.data?.has_more ? (data.data.page_token || '') : ''
  } while (pageToken)

  return departments
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

  return { imported, updated }
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
    const departments = await fetchFeishuDepartments(token)
    const result = await syncDepartmentsToDatabase(orgId, departments)

    return NextResponse.json({
      success: true,
      connector: FEISHU_CONNECTOR,
      scope: FEISHU_SYNC_SCOPE,
      imported: result.imported,
      updated: result.updated,
      total: departments.length,
      message: departments.length === 0 ? '飞书返回 0 个可访问部门' : '飞书部门同步完成',
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
