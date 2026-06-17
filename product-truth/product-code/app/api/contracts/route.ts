// POST /api/contracts - 创建合同草稿
// 支持可选的 quote_id 参数，在创建时带入报价数据作为合同的一个章节

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'
import { logError } from '@/lib/error-log'

// 请求体验证
const createContractSchema = z.object({
  // 基本信息
  contract_no: z.string().optional(),                // 可选，不传则自动生成
  party_a_name: z.string().optional(),               // 甲方（我方），默认从配置读取
  party_b_name: z.string().min(1, '乙方名称不能为空'),
  party_b_contact: z.string().optional(),

  // 日期
  contract_date: z.string().date().optional(),
  effective_date: z.string().date().optional(),
  expiry_date: z.string().date().optional(),

  // 金额条款
  contract_amount: z.number().min(0).optional(),
  tax_amount: z.number().min(0).optional(),
  payment_terms: z.string().optional(),
  delivery_terms: z.string().optional(),

  // 报价引用（可选）- 报价作为合同的一个章节
  quote_id: z.string().uuid().optional(),
  include_quote_items: z.boolean().default(true),    // 是否带入报价明细

  // 备注
  notes: z.string().optional(),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(req: NextRequest) {
  try {
    // 1. 认证
    const user = await requireAuth(req)
    if (!user) {
      return errorResponse('未登录', 401, 'UNAUTHORIZED')
    }

    // 获取 orgId
    const { data: userOrg } = await supabaseAdmin
      .from('user_organizations')
      .select('org_id')
      .eq('user_id', user.id)
      .eq('is_default', true)
      .single()

    const orgId = userOrg?.org_id
    if (!orgId) {
      return errorResponse('未选择组织', 400, 'NO_ORG')
    }

    // 2. 解析请求体
    const body = await req.json()
    const parsed = createContractSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse(
        `参数验证失败: ${parsed.error.issues.map((e) => e.message).join(', ')}`,
        400,
        'VALIDATION_ERROR'
      )
    }

    const { quote_id, include_quote_items, ...contractData } = parsed.data

    interface QuoteItem {
      id: string
      name: string
      specification: string | null
      quantity: number
      unit: string
      unit_price: number
      line_total: number
      sort_order: number
    }

    interface QuoteData {
      id: string
      quote_no: string
      customer_name: string
      customer_contact: string | null
      total_amount: number
      tax_amount: number
      subtotal: number
      payment_terms: string | null
      valid_until: string | null
      status: string
      quote_items: QuoteItem[] | null
    }

    let quoteData: QuoteData | null = null
    let contractAmount = contractData.contract_amount
    let contractItems: Array<{
      quote_item_id: string
      name: string
      specification: string | null
      quantity: number
      unit: string
      unit_price: number
      line_total: number
      sort_order: number
    }> = []

    // 3. 如果传了 quote_id，查询报价数据（作为合同章节引用）
    if (quote_id) {
      const { data: quote, error: quoteError } = await supabaseAdmin
        .from('quotes')
        .select(`
          id,
          quote_no,
          customer_name,
          customer_contact,
          total_amount,
          tax_amount,
          subtotal,
          payment_terms,
          valid_until,
          status,
          quote_items (
            id, name, specification, quantity, unit, unit_price, line_total, sort_order
          )
        `)
        .eq('id', quote_id)
        .single()

      if (quoteError || !quote) {
        return errorResponse('引用的报价不存在或无权访问', 404, 'QUOTE_NOT_FOUND')
      }

      if (quote.status !== 'CONFIRMED') {
        return errorResponse(
          `报价 ${quote.quote_no} 状态为 ${quote.status}，需要已确认才能引用`,
          400,
          'QUOTE_NOT_CONFIRMED'
        )
      }

      quoteData = quote

      // 使用报价数据填充（如果调用方没传）
      if (!contractAmount) contractAmount = quote.total_amount
      if (!contractData.tax_amount) contractData.tax_amount = quote.tax_amount
      if (!contractData.party_b_contact) contractData.party_b_contact = quote.customer_contact

      // 准备合同标的（来自报价明细）
      if (include_quote_items && quote.quote_items) {
        contractItems = quote.quote_items.map((item: QuoteItem) => ({
          quote_item_id: item.id,
          name: item.name,
          specification: item.specification,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          line_total: item.line_total,
          sort_order: item.sort_order,
        }))
      }
    }

    // 4. 生成合同编号（如果没传）
    const contractNo = contractData.contract_no || await generateContractNo()

    // 检查编号唯一性
    const { data: existingNo } = await supabaseAdmin
      .from('contracts')
      .select('id')
      .eq('contract_no', contractNo)
      .maybeSingle()

    if (existingNo) {
      return errorResponse(`合同编号 ${contractNo} 已存在`, 409, 'DUPLICATE_CONTRACT_NO')
    }

    // 5. 创建合同（状态为 DRAFT）
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .insert({
        contract_no: contractNo,
        quote_id: quote_id || null,           // 引用报价（松散关联）
        party_a_name: contractData.party_a_name || '甲方（从配置读取）',
        party_b_name: contractData.party_b_name,
        party_b_contact: contractData.party_b_contact,
        contract_amount: contractAmount || 0,
        tax_amount: contractData.tax_amount || 0,
        contract_date: contractData.contract_date || null,
        effective_date: contractData.effective_date || null,
        expiry_date: contractData.expiry_date || null,
        payment_terms: contractData.payment_terms || null,
        delivery_terms: contractData.delivery_terms || null,
        notes: contractData.notes || null,
        // 文件字段留空，等待上传
        filename: '',
        storage_path: '',
        size: 0,
        mime_type: 'application/octet-stream',
        status: 'DRAFT',
        created_by: user.id,
        org_id: orgId,
      })
      .select()
      .single()

    if (contractError || !contract) {
      await logError({
        message: '合同创建失败',
        error: contractError,
        context: { user_id: user.id },
      })
      return errorResponse('合同创建失败', 500, 'CONTRACT_CREATE_FAILED')
    }

    // 6. 创建合同标的（如果有）
    if (contractItems.length > 0) {
      const itemsToInsert = contractItems.map((item) => ({
        contract_id: contract.id,
        ...item,
      }))

      const { error: itemsError } = await supabaseAdmin
        .from('contract_items')
        .insert(itemsToInsert)

      if (itemsError) {
        await logError({
          source: 'api',
          message: itemsError.message,
          context: {
            contract_id: contract.id,
          },
        })
      }
    }

    // 7. 返回结果
    return NextResponse.json({
      success: true,
      data: {
        contract_id: contract.id,
        contract_no: contract.contract_no,
        status: contract.status,
        party_b_name: contract.party_b_name,
        contract_amount: contract.contract_amount,
        quote_ref: quoteData ? {
          quote_id: quoteData.id,
          quote_no: quoteData.quote_no,
          item_count: contractItems.length,
        } : null,
        message: '合同草稿已创建',
        next_steps: [
          '上传合同文件',
          '编辑合同条款',
          '提交审核',
        ],
        edit_url: `/contracts/${contract.id}/edit`,
      },
    })

  } catch (error: unknown) {
    const err = error as Error
    await logError({
      source: 'api',
      message: err.message,
      error,
      context: {
        route: 'POST /api/contracts',
      },
    })
    return errorResponse('服务器错误', 500, 'INTERNAL_ERROR')
  }
}

// 生成合同编号：CT-YYYYMMDD-XXX
async function generateContractNo(): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')

  const { data: maxContract } = await supabaseAdmin
    .from('contracts')
    .select('contract_no')
    .ilike('contract_no', `CT-${dateStr}-%`)
    .order('contract_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  let seq = 1
  if (maxContract?.contract_no) {
    const match = maxContract.contract_no.match(/CT-\d{8}-(\d{3})$/)
    if (match) {
      seq = parseInt(match[1], 10) + 1
    }
  }

  return `CT-${dateStr}-${String(seq).padStart(3, '0')}`
}
