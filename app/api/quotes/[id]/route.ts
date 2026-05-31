// REQ:F002
// FREEZE-SPEC:4.5

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { contractIdSchema } from '@/lib/validation'
import { z } from 'zod'

// 统一错误响应
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// 报价更新字段验证
const updateQuoteSchema = z.object({
  customer_name: z.string().min(1).max(255).optional(),
  customer_contact: z.string().max(255).optional(),
  subtotal: z.number().nonnegative().optional(),
  tax_amount: z.number().nonnegative().optional(),
  discount_amount: z.number().nonnegative().optional(),
  total_amount: z.number().nonnegative().optional(),
  valid_until: z.string().optional(),
})

// GET /api/quotes/:id - 获取报价详情（需登录）
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAuth(req)

    const idResult = contractIdSchema.safeParse({ id: params.id })
    if (!idResult.success) {
      return errorResponse('无效的报价ID', 400, 'INVALID_ID')
    }

    const { id } = idResult.data

    const { data: quote, error } = await supabaseAdmin
      .from('quotes')
      .select('*, quote_items(*)')
      .eq('id', id)
      .single()

    if (error) {
      console.error('Get quote error:', error)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    if (!quote) {
      return errorResponse('报价不存在', 404, 'NOT_FOUND')
    }

    return NextResponse.json(quote)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get quote error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// PUT /api/quotes/:id - 更新报价（需登录，字段白名单+Zod验证）
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAuth(req)

    const idResult = contractIdSchema.safeParse({ id: params.id })
    if (!idResult.success) {
      return errorResponse('无效的报价ID', 400, 'INVALID_ID')
    }

    const { id } = idResult.data

    // 先查询当前报价状态
    const { data: existingQuote, error: fetchError } = await supabaseAdmin
      .from('quotes')
      .select('id, status')
      .eq('id', id)
      .single()

    if (fetchError || !existingQuote) {
      return errorResponse('报价不存在', 404, 'NOT_FOUND')
    }

    // 已确认的报价不允许修改
    if (existingQuote.status === 'CONFIRMED') {
      return errorResponse('已确认的报价不能修改', 409, 'QUOTE_CONFIRMED')
    }

    const rawData = await req.json()

    // Zod验证输入
    const validation = updateQuoteSchema.safeParse(rawData)
    if (!validation.success) {
      const firstError = validation.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    const updateData = validation.data

    const { data: quote, error } = await supabaseAdmin
      .from('quotes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update quote error:', error)
      return errorResponse('更新失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(quote)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Update quote error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// DELETE /api/quotes/:id - 删除报价（需登录）
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAuth(req)

    const idResult = contractIdSchema.safeParse({ id: params.id })
    if (!idResult.success) {
      return errorResponse('无效的报价ID', 400, 'INVALID_ID')
    }

    const { id } = idResult.data

    // 查询报价是否存在
    const { data: quote, error: fetchError } = await supabaseAdmin
      .from('quotes')
      .select('id, status')
      .eq('id', id)
      .single()

    if (fetchError || !quote) {
      return errorResponse('报价不存在', 404, 'NOT_FOUND')
    }

    // 已确认的报价不允许删除
    if (quote.status === 'CONFIRMED') {
      return errorResponse('已确认的报价不能删除', 409, 'QUOTE_CONFIRMED')
    }

    const { error } = await supabaseAdmin
      .from('quotes')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete quote error:', error)
      return errorResponse('删除失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({ success: true, message: '报价已删除' })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Delete quote error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
