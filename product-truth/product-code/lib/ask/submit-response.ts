import { z } from 'zod'
import type { AuthUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import {
  getAccessibleContract,
  type ScopedRoleAssignment,
} from '@/lib/scoped-access'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { canAccessAskByRoles, getAskResponderRole } from '@/lib/ask/permissions'
import { resolveCurrentReviewArtifactBinding } from '@/lib/contracts/current-review-binding'

const askResponseSchema = z.object({
  response_text: z.string().trim().min(1, '回应内容不能为空').max(10_000, '回应内容不能超过 10000 字'),
  attachments: z.array(z.unknown()).default([]),
})

type AskRow = {
  id: string
  contract_id: string | null
  review_id: string | null
  contract_version_id: string | null
  binding_state: string | null
  status: string | null
  required_roles: string[] | null
  response_id: string | null
}

type DbError = {
  code?: string
  message?: string
}

type AskResponseAggregateRecord = {
  response: {
    id: string
    ask_id: string
    responder_id: string
    responder_role: string
    responder_name: string
    response_text: string
    attachments: unknown[]
    created_at: string | null
  }
  ask_status_after: 'responded'
  report_version: {
    id: string
    version: number
    is_current: boolean
    trigger_event: 'ask_responded'
    created_at: string | null
  }
}

interface SubmitAskResponseOptions {
  askId: string
  contractId?: string
  body: unknown
  user: AuthUser
}

function isUniqueAskResponseError(error: unknown): boolean {
  return (error as DbError | null)?.code === '23505'
}

function validationDetails(error: z.ZodError) {
  return { fieldErrors: error.flatten().fieldErrors }
}

export async function submitAskResponse({
  askId,
  contractId,
  body,
  user,
}: SubmitAskResponseOptions) {
  const parsed = askResponseSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(
      createApiError('VALIDATION_ERROR', '回应内容格式不正确', validationDetails(parsed.error))
    )
  }

  let askQuery = supabaseAdmin
    .from('ask_items')
    .select('id, contract_id, review_id, contract_version_id, binding_state, status, required_roles, response_id')
    .eq('id', askId)

  if (contractId) {
    askQuery = askQuery.eq('contract_id', contractId)
  }

  const { data: ask, error: askError } = await askQuery.single()
  const typedAsk = ask as AskRow | null
  if (askError || !typedAsk?.contract_id) {
    return errorResponse(createApiError('NOT_FOUND', 'ASK 不存在'))
  }

  const access = await getAccessibleContract(
    typedAsk.contract_id,
    user.id,
    undefined,
    'id, current_version_id',
  )
  if (!access.contract) {
    return errorResponse(createApiError('NOT_FOUND', 'ASK 不存在'))
  }
  if (
    typedAsk.binding_state !== 'bound'
    || !typedAsk.review_id
    || !typedAsk.contract_version_id
    || access.contract.current_version_id !== typedAsk.contract_version_id
  ) {
    return errorResponse(
      createApiError('CONFLICT', '该谈判任务不属于当前文件版本，请返回审核工作台重新选择'),
      409,
    )
  }

  const currentBinding = await resolveCurrentReviewArtifactBinding({
    contractId: typedAsk.contract_id,
    currentVersionId: typedAsk.contract_version_id,
    mode: 'write',
  })
  if (
    !currentBinding
    || currentBinding.reviewId !== typedAsk.review_id
    || currentBinding.contractVersionId !== typedAsk.contract_version_id
  ) {
    return errorResponse(
      createApiError('CONFLICT', '该谈判任务属于较早的审核记录，请返回当前审核处理'),
      409,
    )
  }

  if (!canAccessAskByRoles(
    typedAsk.required_roles,
    access.assignments as ScopedRoleAssignment[],
    access.orgId
  )) {
    return errorResponse(createApiError('FORBIDDEN', '当前角色不能回应该 ASK'))
  }

  if (typedAsk.status === 'responded' || typedAsk.response_id) {
    return errorResponse(createApiError('CONFLICT', '该 ASK 已回应，如需修改请先重开'), 409)
  }

  if (typedAsk.status === 'closed') {
    return errorResponse(createApiError('VALIDATION_ERROR', '该 ASK 已关闭，不能录入回应'))
  }

  if (typedAsk.status !== 'pending') {
    return errorResponse(createApiError('CONFLICT', '该 ASK 当前状态不能录入回应'), 409)
  }

  const responderRole = getAskResponderRole(
    access.assignments as ScopedRoleAssignment[],
    access.orgId
  )

  // Response, ASK transition, both audit events and report rollover are one
  // database aggregate. A report failure therefore rolls the response back
  // instead of returning a misleading partial success.
  const { data: aggregateRows, error: aggregateError } = await supabaseAdmin
    .rpc('submit_ask_response_report_aggregate', {
      p_ask_id: askId,
      p_contract_id: typedAsk.contract_id,
      p_review_id: typedAsk.review_id,
      p_contract_version_id: typedAsk.contract_version_id,
      p_responder_id: user.id,
      p_responder_role: responderRole,
      p_responder_name: user.display_name || user.email || 'Unknown',
      p_response_text: parsed.data.response_text,
      p_attachments: parsed.data.attachments,
    })

  const aggregate = (
    Array.isArray(aggregateRows) ? aggregateRows[0] : aggregateRows
  ) as AskResponseAggregateRecord | null

  if (aggregateError || !aggregate?.response || !aggregate.report_version) {
    if (
      isUniqueAskResponseError(aggregateError)
      || aggregateError?.message?.includes('ASK is no longer pending')
    ) {
      return errorResponse(createApiError('CONFLICT', '该 ASK 已回应，如需修改请先重开'), 409)
    }
    if (
      aggregateError?.code === '23514'
      || aggregateError?.code === '40001'
      || aggregateError?.code === '55000'
    ) {
      return errorResponse(
        createApiError('CONFLICT', '该 ASK 或当前审核版本已变化，本次回应未写入，请刷新后重试'),
        409,
      )
    }
    return errorResponse(
      createApiError('DB_ERROR', '提交 ASK 回应失败，本次回应和报告均未写入')
    )
  }

  return successResponse({
    response: aggregate.response,
    ask_status_after: aggregate.ask_status_after,
    report_version: aggregate.report_version,
    report_version_error: null,
    message: '回应已提交，报告版本已更新。',
  }, undefined, 201)
}
