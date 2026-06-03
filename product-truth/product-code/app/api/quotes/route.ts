import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { v4 as uuidv4 } from 'uuid'
import { paginationSchema, quoteSchema } from '@/lib/validation'

// 统一错误响应
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// GET /api/quotes - 获取报价列表（需登录）
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    const { searchParams } = new URL(req.url)

    // Zod验证分页参数
    const pagination = paginationSchema.safeParse({
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
    })

    if (!pagination.success) {
      return errorResponse('分页参数无效', 400, 'INVALID_PAGINATION')
    }

    const { page, pageSize } = pagination.data
    const status = searchParams.get('status')

    let query = supabaseAdmin
      .from('quotes')
      .select('*', { count: 'exact' })
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query.range(
      (page - 1) * pageSize,
      page * pageSize - 1
    )

    if (error) {
      console.error('Get quotes error:', error)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({
      data,
      meta: {
        page,
        pageSize,
        total: count || 0,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get quotes error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// POST /api/quotes - 创建报价（需登录）
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    const body = await req.json()

    // Zod验证
    const result = quoteSchema.safeParse(body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    const { customer_name, customer_contact, valid_until } = result.data

    // SpaceX级确定性报价单号：数据库序列保证唯一性
    const { data: quoteNoResult, error: seqError } = await supabaseAdmin
      .rpc('generate_quote_number')

    if (seqError) {
      console.error('Quote number generation failed:', seqError)
      return errorResponse('报价单号生成失败，请重试', 500, 'SEQUENCE_ERROR')
    }

    const quoteNo = quoteNoResult

    const { data: quote, error } = await supabaseAdmin
      .from('quotes')
      .insert({
        id: uuidv4(),
        quote_no: quoteNo,
        customer_name,
        customer_contact,
        status: 'DRAFT',
        valid_until,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Create quote error:', error)
      return errorResponse('创建报价失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(quote, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Create quote error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
