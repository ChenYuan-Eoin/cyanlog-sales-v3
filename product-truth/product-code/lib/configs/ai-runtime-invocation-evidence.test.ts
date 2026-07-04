import { describe, expect, it } from 'vitest'
import {
  selectRuntimeInvocationEvidence,
  type RuntimeInvocationEvidenceRow,
} from './ai-runtime-invocation-evidence'

describe('AI runtime invocation evidence attribution', () => {
  it('does not attribute a cloud fallback success as the intended local provider actual evidence', () => {
    const rows: RuntimeInvocationEvidenceRow[] = [{
      id: 'inv-cloud-success',
      provider: 'AI_LEVEL_2',
      model: 'gpt-5.5',
      status: 'completed',
      degraded: false,
      request_meta: {
        intended_provider_profile: 'local_primary',
        intended_provider_model: 'gpt-oss-20b',
        requested_provider_profile: 'local_primary',
        requested_provider_accepted: true,
      },
      response_meta: {
        provider_kind: 'openai_compatible',
        transport: 'openai_compatible_http',
        attempt_errors: ['AI_LEVEL_1: health_check_failed'],
      },
    }]

    const localEvidence = selectRuntimeInvocationEvidence(rows, {
      profile: 'local_primary',
      providerKind: 'openai_compatible',
      model: 'gpt-oss-20b',
      sourceConfigKey: 'AI_LEVEL_1',
    })
    const cloudEvidence = selectRuntimeInvocationEvidence(rows, {
      profile: 'sales_cloud_backup',
      providerKind: 'openai_compatible',
      model: 'gpt-5.5',
      sourceConfigKey: 'AI_LEVEL_2',
    })

    expect(localEvidence.actual).toBeNull()
    expect(localEvidence.intended?.id).toBe('inv-cloud-success')
    expect(localEvidence.requested?.id).toBe('inv-cloud-success')
    expect(cloudEvidence.actual?.id).toBe('inv-cloud-success')
    expect(cloudEvidence.intended).toBeNull()
  })

  it('does not treat a previous model invocation as current model evidence', () => {
    const rows: RuntimeInvocationEvidenceRow[] = [{
      id: 'inv-old-model',
      provider: 'AI_LEVEL_2',
      model: 'gpt-4.1',
      status: 'completed',
      degraded: false,
      response_meta: {
        provider_kind: 'openai_compatible',
        transport: 'openai_compatible_http',
      },
    }]

    const evidence = selectRuntimeInvocationEvidence(rows, {
      profile: 'sales_cloud_backup',
      providerKind: 'openai_compatible',
      model: 'gpt-5.5',
      sourceConfigKey: 'AI_LEVEL_2',
    })

    expect(evidence.actual).toBeNull()
    expect(evidence.related).toBeNull()
  })

  it('supports legacy invocations where provider stored the profile instead of config key', () => {
    const rows: RuntimeInvocationEvidenceRow[] = [{
      id: 'inv-profile-provider',
      provider: 'sales_cloud_backup',
      model: 'gpt-5.5',
      status: 'completed',
      degraded: false,
      response_meta: {
        provider_kind: 'openai_compatible',
        transport: 'openai_compatible_http',
      },
    }]

    const evidence = selectRuntimeInvocationEvidence(rows, {
      profile: 'sales_cloud_backup',
      providerKind: 'openai_compatible',
      model: 'gpt-5.5',
      sourceConfigKey: 'AI_LEVEL_2',
    })

    expect(evidence.actual?.id).toBe('inv-profile-provider')
  })
})
