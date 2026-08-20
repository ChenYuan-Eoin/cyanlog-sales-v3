// REQ: WP10 阶段2
// PURPOSE: 商机列表（轻量只读，供报价新建时挂接商机）
// 权限：仅返回当前用户可访问销售空间内的商机；org 管理员返回全部
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId, listAccessibleSalesSpaces } from '@/lib/scoped-access'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'

export const preferredRegion = 'sin1'

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { spaces } = await listAccessibleSalesSpaces(user.id, orgId)
    const spaceIds = spaces.map((s) => s.id)
    if (spaceIds.length === 0) {
      return NextResponse.json({ data: [] })
    }

    const status = req.nextUrl.searchParams.get('status')
    let query = supabaseAdmin
      .from('opportunities')
      .select(`
        id,
        name,
        amount,
        currency,
        status,
        stage,
        expected_close_date,
        source,
        tags,
        owner:users(display_name),
        customer:customers(name, region)
      `)
      .eq('org_id', orgId)
      .in('space_id', spaceIds)
      .order('updated_at', { ascending: false })
      .limit(200)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) {
      console.error('List opportunities error:', error)
      return errorResponse(createApiError('DB_ERROR'))
    }

    const rows = (data || []).map((row: Record<string, unknown>) => {
      const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer
      const c = (customer ?? {}) as { name?: string | null; region?: string | null }
      const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner
      const o = (owner ?? {}) as { display_name?: string | null }
      return {
        id: row.id,
        name: row.name,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        stage: row.stage,
        expected_close_date: row.expected_close_date,
        source: row.source ?? null,
        tags: row.tags ?? [],
        owner_name: o.display_name ?? null,
        customer_name: c.name ?? null,
        customer_region: c.region ?? null,
      }
    })
    return NextResponse.json({ data: rows })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    console.error('List opportunities error:', error)
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
