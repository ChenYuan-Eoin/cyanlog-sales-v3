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
