import { supabaseAdmin } from '@/lib/supabase'
import { firstRelatedRow, type OneOrMany } from '@/lib/ask/relations'

type AskResponseSnapshot = {
  id: string
  responder_id: string | null
  responder_role: string | null
  responder_name: string | null
  response_text: string
  attachments?: unknown
  created_at: string | null
}

type AskItemSnapshot = {
  id: string
  ask_code: string | null
  clause_ref: string | null
  risk_name: string
  initial_level: 'red' | 'yellow' | 'green'
  question_type: string | null
  required_roles: string[] | null
  question_text: string
  qualified_std: string | null
  status: 'pending' | 'responded' | 'closed'
  response_id: string | null
  closed_reason: string | null
  created_at: string | null
  updated_at: string | null
  ask_responses?: OneOrMany<AskResponseSnapshot>
}

type LatestReportVersionRow = {
  id: string
  version: number | null
  is_current: boolean | null
}

type ReportVersionRow = {
  id: string
  version: number
  is_current: boolean
  trigger_event: string
  created_at: string | null
}

type ReportVersionClient = typeof supabaseAdmin

export type AskReportData = {
  generated_at: string
  trigger_event: 'ask_responded'
  trigger_ask_id: string
  summary: {
    total: number
    pending: number
    responded: number
    closed: number
  }
  ask_items: Array<Omit<AskItemSnapshot, 'ask_responses'> & {
    response: AskResponseSnapshot | null
  }>
}

export function buildAskResponseReportData(input: {
  asks: AskItemSnapshot[]
  triggerAskId: string
  generatedAt: string
}): AskReportData {
  const askItems = input.asks.map(({ ask_responses, ...ask }) => ({
    ...ask,
    response: firstRelatedRow(ask_responses),
  }))

  return {
    generated_at: input.generatedAt,
    trigger_event: 'ask_responded',
    trigger_ask_id: input.triggerAskId,
    summary: {
      total: askItems.length,
      pending: askItems.filter((ask) => ask.status === 'pending').length,
      responded: askItems.filter((ask) => ask.status === 'responded').length,
      closed: askItems.filter((ask) => ask.status === 'closed').length,
    },
    ask_items: askItems,
  }
}

export async function createAskResponseReportVersion(input: {
  contractId: string
  triggerAskId: string
  triggerUserId: string
  generatedAt: string
  client?: ReportVersionClient
}): Promise<{
  report: ReportVersionRow | null
  error: string | null
}> {
  const client = input.client || supabaseAdmin

  const latestResult = await client
    .from('report_versions')
    .select('id, version, is_current')
    .eq('contract_id', input.contractId)
    .order('version', { ascending: false })
    .limit(1)

  if (latestResult.error) {
    return { report: null, error: '读取报告版本失败' }
  }

  const latestReport = ((latestResult.data || []) as LatestReportVersionRow[])[0] || null
  const latestVersion = latestReport?.version || 0

  const asksResult = await client
    .from('ask_items')
    .select(`
      id,
      ask_code,
      clause_ref,
      risk_name,
      initial_level,
      question_type,
      required_roles,
      question_text,
      qualified_std,
      status,
      response_id,
      closed_reason,
      created_at,
      updated_at,
      ask_responses!ask_responses_ask_id_fkey (
        id,
        responder_id,
        responder_role,
        responder_name,
        response_text,
        attachments,
        created_at
      )
    `)
    .eq('contract_id', input.contractId)
    .order('created_at', { ascending: true })

  if (asksResult.error) {
    return { report: null, error: '读取 ASK 快照失败' }
  }

  const reportData = buildAskResponseReportData({
    asks: (asksResult.data || []) as AskItemSnapshot[],
    triggerAskId: input.triggerAskId,
    generatedAt: input.generatedAt,
  })

  if (latestReport?.id && latestReport.is_current) {
    const unsetCurrentResult = await client
      .from('report_versions')
      .update({ is_current: false })
      .eq('id', latestReport.id)

    if (unsetCurrentResult.error) {
      return { report: null, error: '更新旧报告版本状态失败' }
    }
  }

  const insertResult = await client
    .from('report_versions')
    .insert({
      contract_id: input.contractId,
      version: latestVersion + 1,
      trigger_event: 'ask_responded',
      trigger_ask_id: input.triggerAskId,
      trigger_user_id: input.triggerUserId,
      no_ask_reason: null,
      report_data: reportData,
      report_file_url: null,
      is_current: true,
    })
    .select('id, version, is_current, trigger_event, created_at')
    .single()

  if (insertResult.error) {
    if (latestReport?.id && latestReport.is_current) {
      await client
        .from('report_versions')
        .update({ is_current: true })
        .eq('id', latestReport.id)
    }
    return { report: null, error: '创建报告版本失败' }
  }

  return {
    report: insertResult.data as ReportVersionRow,
    error: null,
  }
}
