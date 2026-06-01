// REQ:F001
// PURPOSE: Product catalog API - list, create products

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

const productSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  category_id: z.string().uuid().optional(),
  specification: z.string().optional(),
  unit: z.string().optional(),
  base_price: z.number().nonnegative().default(0),
  cost_price: z.number().nonnegative().optional(),
  min_price: z.number().nonnegative().optional(),
  status: z.enum(['active', 'inactive', 'discontinued']).default('active'),
})

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req)

    const { searchParams } = new URL(req.url)
    const categoryId = searchParams.get('category_id')
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    let query = supabaseAdmin
      .from('products')
      .select('*, product_categories(name)')
      .order('created_at', { ascending: false })

    if (categoryId) {
      query = query.eq('category_id', categoryId)
    }

    if (status) {
      query = query.eq('status', status)
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error('Get products error:', error)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(data)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get products error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    const body = await req.json()
    const validated = productSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse('产品数据无效', 400, 'INVALID_DATA')
    }

    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert({
        ...validated.data,
        id: uuidv4(),
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Create product error:', error)
      return errorResponse('创建产品失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Create product error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
