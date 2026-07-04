import { describe, expect, it } from 'vitest'
import {
  canAttemptModelInvocation,
  hasFormalModelInvocationEvidence,
  hasModelInvocationEvidence,
  isHealthOnlyModelState,
} from './ai-runtime-state'

describe('AI runtime state helpers', () => {
  it('only treats completed ReviewRun model invocation as formal evidence', () => {
    expect(hasFormalModelInvocationEvidence('recent_invocation_passed')).toBe(true)
    expect(hasFormalModelInvocationEvidence('remote_health_ok')).toBe(false)
    expect(hasFormalModelInvocationEvidence('local_health_ok')).toBe(false)
    expect(hasFormalModelInvocationEvidence('ready_to_call')).toBe(false)
    expect(hasFormalModelInvocationEvidence('local_cli_ready')).toBe(false)
    expect(hasFormalModelInvocationEvidence('recent_invocation_partial')).toBe(false)
  })

  it('separates attemptable runtime states from formal ReviewRun proof', () => {
    expect(canAttemptModelInvocation('remote_health_ok')).toBe(true)
    expect(canAttemptModelInvocation('local_health_ok')).toBe(true)
    expect(canAttemptModelInvocation('ready_to_call')).toBe(true)
    expect(canAttemptModelInvocation('recent_invocation_partial')).toBe(true)
    expect(canAttemptModelInvocation('remote_auth_failed')).toBe(false)
    expect(canAttemptModelInvocation('builtin_ready')).toBe(false)
  })

  it('counts partial ReviewRun output as model-call evidence but not quality acceptance', () => {
    expect(hasModelInvocationEvidence('recent_invocation_passed')).toBe(true)
    expect(hasModelInvocationEvidence('recent_invocation_partial')).toBe(true)
    expect(hasModelInvocationEvidence('remote_health_ok')).toBe(false)
    expect(hasModelInvocationEvidence('builtin_ready')).toBe(false)
  })

  it('marks health-only states as requiring a real ReviewRun before acceptance', () => {
    expect(isHealthOnlyModelState('remote_health_ok')).toBe(true)
    expect(isHealthOnlyModelState('local_health_ok')).toBe(true)
    expect(isHealthOnlyModelState('ready_to_call')).toBe(true)
    expect(isHealthOnlyModelState('recent_invocation_passed')).toBe(false)
    expect(isHealthOnlyModelState('recent_invocation_partial')).toBe(false)
  })
})
