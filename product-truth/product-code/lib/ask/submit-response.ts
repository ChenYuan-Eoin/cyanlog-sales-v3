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
import { createAskResponseReportVersion } from '@/lib/ask/report-version'

const askResponseSchema = z.object({
  response_text: z.string().trim().min(1, '回应内容不能为空').max(10_000, '回应内容不能超过 10000 字'),
  attachments: z.array(z.unknown()).default([]),
})

type AskRow = {
  id: string
  contract_id: string | null
  status: string | null
  required_roles: string[] | null
  response_id: string | null
}

type DbError = {
  code?: string
  message?: string
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
    .select('id, contract_id, status, required_roles, response_id')
    .eq('id', askId)

  if (contractId) {
    askQuery = askQuery.eq('contract_id', contractId)
  }

  const { data: ask, error: askError } = await askQuery.single()
  const typedAsk = ask as AskRow | null
  if (askError || !typedAsk?.contract_id) {
    return errorResponse(createApiError('NOT_FOUND', 'ASK 不存在'))
  }

  const access = await getAccessibleContract(typedAsk.contract_id, user.id, undefined, 'id')
  if (!access.contract) {
    return errorResponse(createApiError('NOT_FOUND', 'ASK 不存在'))
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

  const now = new Date().toISOString()
  const responderRole = getAskResponderRole(
    access.assignments as ScopedRoleAssignment[],
    access.orgId
  )

  const { data: response, error: responseError } = await supabaseAdmin
    .from('ask_responses')
    .insert({
      ask_id: askId,
      responder_id: user.id,
      responder_role: responderRole,
      responder_name: user.display_name || user.email || 'Unknown',
      response_text: parsed.data.response_text,
      attachments: parsed.data.attachments,
    })
    .select()
    .single()

  if (responseError) {
    if (isUniqueAskResponseError(responseError)) {
      return errorResponse(createApiError('CONFLICT', '该 ASK 已回应，如需修改请先重开'), 409)
    }
    return errorResponse(createApiError('DB_ERROR', '创建 ASK 回应失败'))
  }

  const { data: updatedAsk, error: updateError } = await supabaseAdmin
    .from('ask_items')
    .update({
      status: 'responded',
      response_id: response.id,
      updated_at: now,
    })
    .eq('id', askId)
    .eq('contract_id', typedAsk.contract_id)
    .eq('status', 'pending')
    .is('response_id', null)
    .select('id')
    .single()

  if (updateError || !updatedAsk) {
    await supabaseAdmin.from('ask_responses').delete().eq('id', response.id)
    return errorResponse(createApiError('CONFLICT', '该 ASK 状态已变化，请刷新后重试'), 409)
  }

  await supabaseAdmin
    .from('ask_audit_logs')
    .insert({
      ask_id: askId,
      contract_id: typedAsk.contract_id,
      actor_id: user.id,
      actor_role: responderRole,
      event_type: 'responded',
      from_status: 'pending',
      to_status: 'responded',
      payload: { response_id: response.id },
    })

  const reportResult = await createAskResponseReportVersion({
    contractId: typedAsk.contract_id,
    triggerAskId: askId,
    triggerUserId: user.id,
    generatedAt: now,
  })

  if (reportResult.report) {
    await supabaseAdmin
      .from('ask_audit_logs')
      .insert({
        ask_id: askId,
        contract_id: typedAsk.contract_id,
        actor_id: user.id,
        actor_role: responderRole,
        event_type: 'report_generated',
        from_status: 'responded',
        to_status: 'responded',
        payload: {
          response_id: response.id,
          report_version_id: reportResult.report.id,
          report_version: reportResult.report.version,
          trigger_event: 'ask_responded',
        },
      })
  }

  return successResponse({
    response,
    ask_status_after: 'responded',
    report_version: reportResult.report,
    report_version_error: reportResult.error,
    message: reportResult.report
      ? '回应已提交，报告版本已更新。'
      : '回应已提交，但报告版本更新失败，请刷新报告或联系管理员。',
  }, undefined, 201)
}
