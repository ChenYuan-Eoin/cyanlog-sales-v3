import type { RuntimeInvocationEvidence } from '@/lib/configs/ai-runtime-readiness'

type JsonRecord = Record<string, unknown>

export type RuntimeInvocationEvidenceRow = RuntimeInvocationEvidence & {
  request_meta?: JsonRecord | null
}

export type RuntimeProviderEvidenceTarget = {
  profile: string
  providerKind: 'openai_compatible' | 'builtin'
  model?: string | null
  sourceConfigId?: string | null
  sourceConfigKey?: string | null
  provider?: string | null
}

export type RuntimeProviderInvocationEvidence = {
  actual: RuntimeInvocationEvidenceRow | null
  intended: RuntimeInvocationEvidenceRow | null
  requested: RuntimeInvocationEvidenceRow | null
  related: RuntimeInvocationEvidenceRow | null
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function normalizedValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null
}

function stringValues(values: unknown[]): Set<string> {
  return new Set(values.map(normalizedValue).filter((value): value is string => Boolean(value)))
}

function targetActualIdentifiers(target: RuntimeProviderEvidenceTarget): Set<string> {
  const values: unknown[] = [
    target.profile,
    target.sourceConfigId,
    target.sourceConfigKey,
  ]

  if (target.providerKind === 'builtin') {
    values.push(target.provider, 'rule-engine', 'rule_engine')
  }

  return stringValues(values)
}

function invocationActualIdentifiers(invocation: RuntimeInvocationEvidenceRow): Set<string> {
  const requestMeta = recordValue(invocation.request_meta)
  const responseMeta = recordValue(invocation.response_meta)
  return stringValues([
    invocation.provider,
    requestMeta.actual_provider_profile,
    requestMeta.actual_provider_key,
    responseMeta.actual_provider_profile,
    responseMeta.actual_provider_key,
    responseMeta.provider_profile,
    responseMeta.provider_key,
  ])
}

function hasIntersection(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) return true
  }
  return false
}

function modelMatches(actualModel: unknown, targetModel: string | null | undefined): boolean {
  const expected = normalizedValue(targetModel)
  if (!expected) return true
  const actual = normalizedValue(actualModel)
  return !actual || actual === expected
}

function isActualInvocationForTarget(
  invocation: RuntimeInvocationEvidenceRow,
  target: RuntimeProviderEvidenceTarget
): boolean {
  return hasIntersection(invocationActualIdentifiers(invocation), targetActualIdentifiers(target))
    && modelMatches(invocation.model, target.model)
}

function requestMetaMatches(
  invocation: RuntimeInvocationEvidenceRow,
  profileKey: 'intended_provider_profile' | 'requested_provider_profile',
  modelKey: 'intended_provider_model' | 'requested_provider_model',
  target: RuntimeProviderEvidenceTarget
): boolean {
  const requestMeta = recordValue(invocation.request_meta)
  const expectedProfile = normalizedValue(target.profile)
  const actualProfile = normalizedValue(requestMeta[profileKey])
  if (!expectedProfile || actualProfile !== expectedProfile) return false

  return modelMatches(requestMeta[modelKey], target.model)
}

export function selectRuntimeInvocationEvidence(
  rows: RuntimeInvocationEvidenceRow[],
  target: RuntimeProviderEvidenceTarget
): RuntimeProviderInvocationEvidence {
  let actual: RuntimeInvocationEvidenceRow | null = null
  let intended: RuntimeInvocationEvidenceRow | null = null
  let requested: RuntimeInvocationEvidenceRow | null = null

  for (const row of rows) {
    if (!actual && isActualInvocationForTarget(row, target)) {
      actual = row
    }
    if (!intended && requestMetaMatches(row, 'intended_provider_profile', 'intended_provider_model', target)) {
      intended = row
    }
    if (!requested && requestMetaMatches(row, 'requested_provider_profile', 'requested_provider_model', target)) {
      requested = row
    }
    if (actual && intended && requested) break
  }

  return {
    actual,
    intended,
    requested,
    related: actual || intended || requested,
  }
}
