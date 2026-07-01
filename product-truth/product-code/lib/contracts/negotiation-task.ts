import { firstRelatedRow, type OneOrMany } from '@/lib/ask/relations'

export type NegotiationRiskSource = {
  id: string
  level: 'red' | 'yellow' | 'green' | 'white'
  title: string
  description?: string | null
  suggestion?: string | null
  status?: string | null
}

export type NegotiationAskResponseSource = {
  id: string
  responder_name: string
  responder_role: string
  response_text: string
  created_at: string | null
}

export type NegotiationAskSource = {
  id: string
  ask_code?: string | null
  risk_name?: string | null
  initial_level: 'red' | 'yellow' | 'green'
  question_type?: string | null
  required_roles?: string[] | null
  question_text: string
  qualified_std?: string | null
  status: 'pending' | 'responded' | 'closed'
  closed_reason?: string | null
  ask_responses?: OneOrMany<NegotiationAskResponseSource>
}

export type NegotiationTask = {
  id: string
  source: 'ask' | 'risk_card_suggestion'
  ask_code: string | null
  risk_id: string | null
  required: boolean
  owner_role: string
  status: string
  title: string
  objective: string
  standard: string | null
  response: NegotiationAskResponseSource | null
  closed_reason: string | null
}

function ownerRole(roles: string[] | null | undefined) {
  const normalized = (roles || []).filter(Boolean)
  return normalized.length > 0 ? normalized.join('/') : 'sales'
}

function riskRequiresNegotiation(risk: NegotiationRiskSource) {
  return (risk.level === 'red' || risk.level === 'yellow') && (!risk.status || risk.status === 'open')
}

function findRiskForAsk(risks: NegotiationRiskSource[], ask: NegotiationAskSource) {
  return risks.find((risk) => risk.title === ask.risk_name) || null
}

function buildRiskFallbackTask(risk: NegotiationRiskSource): NegotiationTask {
  return {
    id: `negotiation-${risk.id}`,
    source: 'risk_card_suggestion',
    ask_code: null,
    risk_id: risk.id,
    required: risk.level === 'red',
    owner_role: 'sales',
    status: 'pending',
    title: risk.level === 'red' ? '必须谈判' : '建议谈判',
    objective: risk.suggestion || risk.description || risk.title,
    standard: null,
    response: null,
    closed_reason: null,
  }
}

export function buildNegotiationTasks(input: {
  risks: NegotiationRiskSource[]
  asks: NegotiationAskSource[]
}): NegotiationTask[] {
  const tasksFromAsks = input.asks.map((ask) => {
    const matchedRisk = findRiskForAsk(input.risks, ask)
    const riskName = ask.risk_name || '谈判事项'

    return {
      id: ask.id,
      source: 'ask',
      ask_code: ask.ask_code || null,
      risk_id: matchedRisk?.id || null,
      required: ask.initial_level === 'red',
      owner_role: ownerRole(ask.required_roles),
      status: ask.status,
      title: ask.ask_code ? `${ask.ask_code} ${riskName}` : riskName,
      objective: ask.question_text,
      standard: ask.qualified_std || null,
      response: firstRelatedRow(ask.ask_responses),
      closed_reason: ask.closed_reason || null,
    } satisfies NegotiationTask
  })

  const askRiskNames = new Set(
    input.asks
      .map((ask) => ask.risk_name)
      .filter((name): name is string => Boolean(name))
  )
  const fallbackTasks = input.risks
    .filter(riskRequiresNegotiation)
    .filter((risk) => !askRiskNames.has(risk.title))
    .map(buildRiskFallbackTask)

  return [...tasksFromAsks, ...fallbackTasks]
}
