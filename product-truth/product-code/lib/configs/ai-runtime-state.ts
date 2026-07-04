import type { AIRuntimeState } from './ai-runtime-readiness'

const ATTEMPTABLE_MODEL_STATES = new Set<AIRuntimeState>([
  'ready_to_call',
  'local_health_ok',
  'remote_health_ok',
  'local_cli_ready',
  'recent_invocation_passed',
  'recent_invocation_partial',
])

const HEALTH_ONLY_STATES = new Set<AIRuntimeState>([
  'ready_to_call',
  'local_health_ok',
  'remote_health_ok',
  'local_cli_ready',
])

export function hasFormalModelInvocationEvidence(state: AIRuntimeState): boolean {
  return state === 'recent_invocation_passed'
}

export function hasModelInvocationEvidence(state: AIRuntimeState): boolean {
  return state === 'recent_invocation_passed' || state === 'recent_invocation_partial'
}

export function canAttemptModelInvocation(state: AIRuntimeState): boolean {
  return ATTEMPTABLE_MODEL_STATES.has(state)
}

export function isHealthOnlyModelState(state: AIRuntimeState): boolean {
  return HEALTH_ONLY_STATES.has(state)
}
