// REQ:F003 - 部门管理 API
// PURPOSE: 部门的增删改查

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canAccessOrgAdmin } from '@/lib/permissions'

// GET /api/admin/departments - 获取部门列表
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const { orgId } = user

    const { data: departments, error } = await supabaseAdmin
      .from('departments')
      .select('id, name, code, depth, member_count, parent_id, sort_order, status')
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
    const { orgId, id: userId } = user

    // 权限检查
    const userPerms = req.headers.get('x-user-permissions')?.split(',') || []
    const roleCodes = req.headers.get('x-user-role-codes')?.split(',') || []

    if (!canAccessOrgAdmin(userPerms, roleCodes)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    const body = await req.json()
    const { name, code, parent_id } = body

    // 校验
    if (!name || !code) {
      return NextResponse.json({ error: '部门名称和编码不能为空' }, { status: 400 })
    }

    // 检查 code 唯一性
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('departments')
      .select('id')
      .eq('org_id', orgId)
      .eq('code', code)
      .single()

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

    // 插入数据
    const { data, error } = await supabaseAdmin
      .from('departments')
      .insert({
        org_id: orgId,
        name,
        code,
        parent_id: parent_id || null,
        depth,
        member_count: 0,
        status: 'active',
        source: 'manual',
      })
      .select('id, name, code, depth, member_count, parent_id, sort_order')
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
