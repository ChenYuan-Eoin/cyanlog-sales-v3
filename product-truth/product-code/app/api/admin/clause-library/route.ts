// REQ:F005 - 条款库管理 API
// PURPOSE: 增删改查条款库

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// GET /api/admin/clause-library - 列出条款
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')
    const stance = searchParams.get('stance')

    let query = supabaseAdmin
      .from('clause_library')
      .select('id, name, category, stance, contract_types, template_text, legal_basis, description, tags, is_system, org_id, created_at, updated_at')
      .or(`org_id.is.null,org_id.eq.${orgId}`)
      .order('category', { ascending: true })
      .order('stance', { ascending: true })

    if (category) query = query.eq('category', category)
    if (stance) query = query.eq('stance', stance)

    const { data, error } = await query
    if (error) return errorResponse('查询失败', 500, 'DB_ERROR')

    return NextResponse.json({
      success: true,
      data: { clauses: data || [] },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录', 401, 'UNAUTHORIZED')
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// POST /api/admin/clause-library - 创建条款
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)

    const body = (await req.json().catch(() => ({}))) as {
      name?: string
      category?: string
      stance?: string
      contract_types?: string[]
      template_text?: string
      legal_basis?: string
      description?: string
      tags?: string[]
    }

    if (!body.name || !body.category || !body.template_text) {
      return errorResponse('缺少必填字段', 400, 'MISSING_FIELDS')
    }
    if (!['required', 'recommended', 'optional', 'risky', 'dangerous'].includes(body.stance || 'recommended')) {
      return errorResponse('立场值不合法', 400, 'INVALID_STANCE')
    }

    const { data, error } = await supabaseAdmin
      .from('clause_library')
      .insert({
        org_id: orgId,
        name: body.name,
        category: body.category,
        stance: body.stance || 'recommended',
        contract_types: body.contract_types || [],
        template_text: body.template_text,
        legal_basis: body.legal_basis || null,
        description: body.description || null,
        tags: body.tags || [],
        is_system: false,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) return errorResponse('创建失败', 500, 'DB_ERROR')

    return NextResponse.json({ success: true, data })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录', 401, 'UNAUTHORIZED')
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
