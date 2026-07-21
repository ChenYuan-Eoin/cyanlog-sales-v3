// REQ:F005
// PURPOSE: 生成合同 ASK 清单 - AI 规则扫描后生成

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getAccessibleContract } from '@/lib/scoped-access'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { resolveCurrentReviewArtifactBinding } from '@/lib/contracts/current-review-binding'

interface AskInput {
  clause_ref?: string | null
  risk_name: string
  level: 'red' | 'yellow' | 'green'
  type: 'commercial' | 'financial' | 'legal' | 'technical' | 'compliance'
  roles?: string[]
  question: string
  standard: string
}

type RiskCardRow = {
  clause_ref: string | null
  title: string
  description: string | null
  suggestion: string | null
  level: 'red' | 'yellow' | 'green' | 'white'
}

const askInputSchema = z.object({
  clause_ref: z.string().optional().nullable(),
  risk_name: z.string().trim().min(1),
  level: z.enum(['red', 'yellow', 'green']).default('yellow'),
  type: z.enum(['commercial', 'financial', 'legal', 'technical', 'compliance']).default('commercial'),
  roles: z.array(z.string().trim().min(1)).optional(),
  question: z.string().trim().min(1),
  standard: z.string().trim().min(1),
})

const generateAskSchema = z.object({
  asks: z.array(askInputSchema).optional(),
})

function inferAskRoute(text: string): Pick<AskInput, 'type' | 'roles'> {
  if (/付款|账期|税|发票|金额|结算|回款|费用/.test(text)) {
    return { type: 'financial', roles: ['finance'] }
  }
  if (/交付|验收|实施|上线|SLA|服务等级|工期/.test(text)) {
    return { type: 'technical', roles: ['technical'] }
  }
  if (/保密|知识产权|违约|争议|管辖|解除|赔偿|法律|合规/.test(text)) {
    return { type: 'legal', roles: ['legal'] }
  }
  return { type: 'commercial', roles: ['sales'] }
}

function normalizeAskLevel(level: RiskCardRow['level']): AskInput['level'] {
  return level === 'red' || level === 'yellow' || level === 'green' ? level : 'yellow'
}

function createAskFromRiskCard(card: RiskCardRow): AskInput {
  const text = `${card.title} ${card.description || ''} ${card.suggestion || ''}`
  const route = inferAskRoute(text)
  return {
    clause_ref: card.clause_ref,
    risk_name: card.title,
    level: normalizeAskLevel(card.level),
    type: route.type,
    roles: route.roles,
    question: card.description
      ? `请确认该风险的业务处理意见：${card.description}`
      : `请确认该风险的业务处理意见：${card.title}`,
    standard: card.suggestion || '请补充可接受的处理方案、业务依据或让步条件。',
  }
}

function normalizeRequiredRoles(roles: string[] | undefined): string[] {
  const normalized = (roles || [])
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean)
    .map((role) => {
      if (role === 'financial') return 'finance'
      if (role === 'delivery') return 'technical'
      if (role === 'compliance') return 'legal'
      return role
    })

  return Array.from(new Set(normalized.length > 0 ? normalized : ['sales']))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const { id: contractId } = await params
    const body = await req.json().catch(() => ({}))

    const access = await getAccessibleContract(
      contractId,
      user.id,
      undefined,
      'id, current_version_id',
    )
    if (!access.contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

    const binding = await resolveCurrentReviewArtifactBinding({
      contractId,
      currentVersionId: typeof access.contract.current_version_id === 'string'
        ? access.contract.current_version_id
        : null,
      mode: 'write',
    })
    if (!binding) {
      return errorResponse(
        createApiError('CONFLICT', '当前文件版本还没有审核结果，不能生成谈判任务'),
        409,
      )
    }

    const parsed = generateAskSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse(
        createApiError('VALIDATION_ERROR', 'ASK 生成参数不正确', {
          fieldErrors: parsed.error.flatten().fieldErrors,
        })
      )
    }

    const { data: existingAsks, error: existingError } = await supabaseAdmin
      .from('ask_items')
      .select('*')
      .eq('contract_id', contractId)
      .eq('review_id', binding.reviewId)
      .eq('contract_version_id', binding.contractVersionId)
      .eq('binding_state', 'bound')
      .order('created_at', { ascending: true })

    if (existingError) {
      return errorResponse(createApiError('DB_ERROR', '读取已有 ASK 失败'))
    }

    if ((existingAsks || []).length > 0) {
      return successResponse(existingAsks || [])
    }

    let asks: AskInput[] = parsed.data.asks || []

    if (asks.length === 0) {
      const { data: riskCards, error: riskError } = await supabaseAdmin
        .from('contract_risk_cards')
        .select('clause_ref, title, description, suggestion, level')
        .eq('contract_id', contractId)
        .eq('review_id', binding.reviewId)
        .eq('status', 'open')
        .in('level', ['red', 'yellow'])
        .order('created_at', { ascending: true })

      if (riskError) {
        return errorResponse(createApiError('DB_ERROR', '读取风险卡片失败'))
      }

      asks = ((riskCards || []) as RiskCardRow[]).map(createAskFromRiskCard)
    }

    if (asks.length === 0) {
      return successResponse([])
    }

    const { data, error } = await supabaseAdmin
      .from('ask_items')
      .insert(
        asks.map((ask, idx) => ({
          contract_id: contractId,
          review_id: binding.reviewId,
          contract_version_id: binding.contractVersionId,
          binding_state: 'bound',
          ask_code: `ASK-${String(idx + 1).padStart(3, '0')}`,
          clause_ref: ask.clause_ref || null,
          risk_name: ask.risk_name,
          initial_level: ask.level,
          question_type: ask.type,
          required_roles: normalizeRequiredRoles(ask.roles),
          question_text: ask.question,
          qualified_std: ask.standard,
          status: 'pending',
          trigger_user_id: user.id,
        }))
      )
      .select()

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '生成 ASK 清单失败'))
    }

    await supabaseAdmin
      .from('contracts')
      .update({ status: 'ASK_GENERATED', asks_count: asks.length })
      .eq('id', contractId)
      .eq('org_id', access.orgId)
      .in('created_by', access.userIds)

    return successResponse(data || [], undefined, 201)
  } catch (err: unknown) {
    const authError = err instanceof Error && err.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    return NextResponse.json({ error: '生成 ASK 失败' }, { status: 500 })
  }
}
