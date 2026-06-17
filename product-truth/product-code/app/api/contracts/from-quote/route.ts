// POST /api/contracts/from-quote - 从报价生成合同草稿
// REQ: F002 -> F005 链路

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, requireOrg } from '@/lib/auth'
import { z } from 'zod'
import { logError } from '@/lib/error-log'
import { v4 as uuidv4 } from 'uuid'

// 请求体验证
const fromQuoteSchema = z.object({
  quote_id: z.string().uuid({ message: '无效的报价ID' }),
  // 可选：覆盖报价数据的字段
  party_b_name: z.string().optional(),
  contract_date: z.string().date().optional(),
  effective_date: z.string().date().optional(),
  expiry_date: z.string().date().optional(),
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

    const orgId = await requireOrg(user.id)
    if (!orgId) {
      return errorResponse('未选择组织', 400, 'NO_ORG')
    }

    // 2. 解析请求体
    const body = await req.json()
    const parsed = fromQuoteSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse(
        `参数验证失败: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
        400,
        'VALIDATION_ERROR'
      )
    }

    const { quote_id, ...overrides } = parsed.data

    // 3. 查询报价（带权限检查）
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
        created_by,
        quote_items (
          id,
          name,
          specification,
          quantity,
          unit,
          unit_price,
          line_total,
          sort_order
        )
      `)
      .eq('id', quote_id)
      .single()

    if (quoteError || !quote) {
      return errorResponse('报价不存在或无权访问', 404, 'QUOTE_NOT_FOUND')
    }

    // 4. 检查报价状态（必须已确认）
    if (quote.status !== 'CONFIRMED') {
      return errorResponse(
        `报价状态为 ${quote.status}，需要 CONFIRMED 状态才能生成合同`,
        400,
        'QUOTE_NOT_CONFIRMED'
      )
    }

    // 5. 检查是否已生成合同（避免重复）
    const { data: existingContract } = await supabaseAdmin
      .from('contracts')
      .select('id, status')
      .eq('quote_id', quote_id)
      .maybeSingle()

    if (existingContract) {
      return errorResponse(
        `该报价已生成合同: ${existingContract.id}`,
        409,
        'CONTRACT_ALREADY_EXISTS'
      )
    }

    // 6. 生成合同编号
    const contractNo = await generateContractNo()

    // 7. 创建合同
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .insert({
        contract_no: contractNo,
        quote_id: quote.id,
        party_a_name: '甲方名称（从配置读取）', // TODO: 从配置中心读取
        party_b_name: overrides.party_b_name || quote.customer_name,
        party_b_contact: quote.customer_contact,
        contract_amount: quote.total_amount,
        tax_amount: quote.tax_amount,
        payment_terms: quote.payment_terms,
        delivery_date: quote.valid_until,
        contract_date: overrides.contract_date || null,
        effective_date: overrides.effective_date || null,
        expiry_date: overrides.expiry_date || null,
        // 文件相关字段留空，等待上传
        filename: '',
        storage_path: '',
        size: 0,
        mime_type: 'application/octet-stream',
        status: 'DRAFT', // DRAFT 状态，等待上传合同文件
        notes: overrides.notes || null,
        created_by: user.id,
        org_id: orgId,
      })
      .select()
      .single()

    if (contractError || !contract) {
      await logError('contract_create_failed', contractError?.message || 'unknown', {
        quote_id,
        user_id: user.id,
      })
      return errorResponse('合同创建失败', 500, 'CONTRACT_CREATE_FAILED')
    }

    // 8. 复制报价明细到合同标的
    if (quote.quote_items && quote.quote_items.length > 0) {
      const contractItems = quote.quote_items.map((item: any) => ({
        contract_id: contract.id,
        quote_item_id: item.id,
        name: item.name,
        specification: item.specification,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        line_total: item.line_total,
        sort_order: item.sort_order,
      }))

      const { error: itemsError } = await supabaseAdmin
        .from('contract_items')
        .insert(contractItems)

      if (itemsError) {
        await logError('contract_items_create_failed', itemsError.message, {
          contract_id: contract.id,
          quote_id,
        })
        // 不阻止流程，继续返回合同
      }
    }

    // 9. 更新报价的关联合同ID
    await supabaseAdmin
      .from('quotes')
      .update({ generated_contract_id: contract.id })
      .eq('id', quote_id)

    // 10. 返回成功响应
    return NextResponse.json({
      success: true,
      data: {
        contract_id: contract.id,
        contract_no: contract.contract_no,
        quote_id: quote.id,
        quote_no: quote.quote_no,
        status: contract.status,
        party_b_name: contract.party_b_name,
        contract_amount: contract.contract_amount,
        message: '合同草稿已创建，请前往编辑页面上传合同文件',
        edit_url: `/contracts/${contract.id}/edit`,
      },
    })

  } catch (error: any) {
    await logError('from_quote_api_error', error.message, {
      stack: error.stack,
    })
    return errorResponse('服务器错误', 500, 'INTERNAL_ERROR')
  }
}

// 生成合同编号：CT-YYYYMMDD-XXX
async function generateContractNo(): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')

  // 查询当天最大序号
  const { data: maxContract } = await supabaseAdmin
    .from('contracts')
    .select('contract_no')
    .ilike('contract_no', `CT-${dateStr}-%`)
    .order('contract_no', { ascending: false })
    .limit(1)
    .single()

  let seq = 1
  if (maxContract?.contract_no) {
    const match = maxContract.contract_no.match(/CT-\d{8}-(\d{3})$/)
    if (match) {
      seq = parseInt(match[1], 10) + 1
    }
  }

  return `CT-${dateStr}-${String(seq).padStart(3, '0')}`
}
