// REQ:F003 - 部门管理 API
// PURPOSE: 部门的增删改查

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canAccessOrgAdmin } from '@/lib/permissions'
import { getDefaultOrgId } from '@/lib/scoped-access'

const uuidSchema = z.string().regex(/^[0-9a-f-]{36}$/i, 'ID 格式不正确')
const createDepartmentSchema = z.object({
  name: z.string().trim().min(1, '部门名称不能为空').max(80, '部门名称不能超过 80 字'),
  code: z.string().trim().min(1, '部门编码不能为空').max(50, '部门编码不能超过 50 字'),
  parent_id: uuidSchema.nullable().optional(),
  leader_id: uuidSchema.nullable().optional(),
})

function validationError(result: z.ZodError) {
  return NextResponse.json(
    { error: result.issues[0]?.message || '部门参数不正确', code: 'VALIDATION_ERROR' },
    { status: 400 }
  )
}

async function assertUserInOrg(orgId: string, userId: string | null | undefined) {
  if (!userId) {
    return null
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id', userId)
    .eq('org_id', orgId)
    .neq('status', 'inactive')
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return data
}

// GET /api/admin/departments - 获取部门列表
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)

    const { data: departments, error } = await supabaseAdmin
      .from('departments')
      .select('id, name, code, depth, member_count, parent_id, leader_id, sort_order, status')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .order('depth', { ascending: true })
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('Fetch departments error:', error)
      return NextResponse.json({ error: '获取部门列表失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: departments || [],
    })
  } catch (err) {
    console.error('GET departments error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// POST /api/admin/departments - 创建部门
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)

    // 权限检查
    const userPerms = req.headers.get('x-user-permissions')?.split(',') || []
    const roleCodes = req.headers.get('x-user-role-codes')?.split(',') || []

    if (!canAccessOrgAdmin(userPerms, roleCodes)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    const parseResult = createDepartmentSchema.safeParse(await req.json())
    if (!parseResult.success) {
      return validationError(parseResult.error)
    }
    const { name, code, parent_id, leader_id } = parseResult.data

    // 检查 code 唯一性
    const { data: existing } = await supabaseAdmin
      .from('departments')
      .select('id')
      .eq('org_id', orgId)
      .eq('code', code)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: '部门编码已存在' }, { status: 409 })
    }

    // 计算 depth
    let depth = 0
    if (parent_id) {
      const { data: parent, error: parentError } = await supabaseAdmin
        .from('departments')
        .select('depth')
        .eq('id', parent_id)
        .eq('org_id', orgId)
        .single()

      if (parentError || !parent) {
        return NextResponse.json({ error: '上级部门不存在' }, { status: 400 })
      }
      depth = (parent.depth || 0) + 1
    }

    if (leader_id) {
      const leader = await assertUserInOrg(orgId, leader_id)
      if (!leader) {
        return NextResponse.json({ error: '部门主管不存在', code: 'INVALID_LEADER' }, { status: 400 })
      }
    }

    // 插入数据
    const { data, error } = await supabaseAdmin
      .from('departments')
      .insert({
        org_id: orgId,
        name,
        code,
        parent_id: parent_id || null,
        leader_id: leader_id || null,
        depth,
        member_count: 0,
        status: 'active',
        source: 'manual',
      })
      .select('id, name, code, depth, member_count, parent_id, leader_id, sort_order')
      .single()

    if (error) {
      console.error('Create department error:', error)
      return NextResponse.json({ error: '创建部门失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data,
      message: '部门创建成功',
    }, { status: 201 })
  } catch (err) {
    console.error('POST department error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
