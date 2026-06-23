// POST /api/contracts/drafts - 创建合同草稿
// GET /api/contracts/drafts - 获取草稿列表
// REQ: F005v2 - Phase 1

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import {
  errorResponse,
  successResponse,
  createdResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

// 请求体验证
const createDraftSchema = z.object({
  title: z.string().min(1, '标题不能为空'),
  party_a_name: z.string().optional(),
  party_b_name: z.string().optional(),
  party_b_contact: z.string().optional(),
  contract_amount: z.number().min(0).optional(),
  tax_amount: z.number().min(0).optional(),
  quote_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  business_params: z.record(z.string(), z.unknown()).optional(),
  clause_toggles: z.record(z.string(), z.boolean()).optional(),
})

// GET /api/contracts/drafts - 获取当前用户的草稿列表
export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    let query = supabaseAdmin
      .from('contract_drafts')
      .select('*')
      .eq('org_id', orgId)
      .eq('created_by', user.id)
      .order('updated_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    const { data: drafts, error } = await query

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '获取草稿列表失败'))
    }

    return successResponse(drafts || [])
  })
}

// POST /api/contracts/drafts - 创建草稿
export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const body = await req.json().catch(() => ({}))
    const parsed = createDraftSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(
        createApiError(
          'VALIDATION_ERROR',
          `参数验证失败: ${parsed.error.issues.map((e) => e.message).join(', ')}`
        )
      )
    }

    const { data: draft, error } = await supabaseAdmin
      .from('contract_drafts')
      .insert({
        org_id: orgId,
        created_by: user.id,
        title: parsed.data.title,
        party_a_name: parsed.data.party_a_name,
        party_b_name: parsed.data.party_b_name,
        party_b_contact: parsed.data.party_b_contact,
        contract_amount: parsed.data.contract_amount,
        tax_amount: parsed.data.tax_amount,
        quote_id: parsed.data.quote_id,
        customer_id: parsed.data.customer_id,
        business_params: parsed.data.business_params || {},
        clause_toggles: parsed.data.clause_toggles || {},
        status: 'draft',
      })
      .select()
      .single()

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '创建草稿失败'))
    }

    return createdResponse(draft)
  })
}
