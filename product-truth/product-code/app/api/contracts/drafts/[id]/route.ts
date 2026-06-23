// /api/contracts/drafts/:id
// GET - 获取草稿详情
// PATCH - 更新草稿
// DELETE - 删除草稿

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import {
  errorResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

const updateDraftSchema = z.object({
  title: z.string().min(1).optional(),
  party_a_name: z.string().optional(),
  party_b_name: z.string().optional(),
  party_b_contact: z.string().optional(),
  contract_amount: z.number().min(0).optional(),
  tax_amount: z.number().min(0).optional(),
  business_params: z.record(z.string(), z.unknown()).optional(),
  clause_toggles: z.record(z.string(), z.boolean()).optional(),
  ai_additions: z.array(z.record(z.string(), z.unknown())).optional(),
  generated_content: z.string().optional(),
  status: z.enum(['draft', 'generated', 'submitted_for_review', 'approved']).optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params

    const { data: draft, error } = await supabaseAdmin
      .from('contract_drafts')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('created_by', user.id)
      .single()

    if (error || !draft) {
      return errorResponse(createApiError('NOT_FOUND', '草稿不存在或无权访问'))
    }

    return successResponse(draft)
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = updateDraftSchema.safeParse(body)

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
      .update(parsed.data)
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('created_by', user.id)
      .select()
      .single()

    if (error || !draft) {
      return errorResponse(createApiError('NOT_FOUND', '草稿不存在或更新失败'))
    }

    return successResponse(draft)
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params

    const { error } = await supabaseAdmin
      .from('contract_drafts')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('created_by', user.id)

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '删除草稿失败'))
    }

    return successResponse({ id })
  })
}
