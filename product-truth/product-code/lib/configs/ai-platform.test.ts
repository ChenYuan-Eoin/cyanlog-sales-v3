import { describe, expect, it } from 'vitest'
import {
  validateAIPlatformPublishGraph,
  validateAIPlatformReferences,
  type AIPlatformConfigLike,
} from './ai-platform'

function row(
  id: string,
  kind: string,
  assetId: string,
  value: Record<string, unknown>,
  status: AIPlatformConfigLike['status'] = 'PUBLISHED',
): AIPlatformConfigLike {
  return {
    id,
    key: id.toUpperCase().replace(/[^A-Z0-9]/g, '_'),
    status,
    value: {
      schema_version: 'ai-platform.v1',
      kind,
      asset_id: assetId,
      enabled: true,
      ...value,
    },
  }
}

const provider = row('provider-1', 'provider_connection', 'provider.cloud', {
  provider_type: 'openai_compatible',
  runtime_location: 'cloud',
  auth_mode: 'none',
  base_url: 'https://provider.example/v1',
  connection_timeout_ms: 45000,
})
const primaryModel = row('model-1', 'model_catalog_entry', 'model.primary', {
  provider_connection_id: 'provider.cloud',
  model_id: 'vendor/primary',
  capabilities: ['text_generation', 'structured_output'],
})
const application = row('app-1', 'ai_application', 'review.assistant', {
  capabilities: ['text_generation', 'structured_output'],
})
const usePoint = row('use-1', 'business_use_point', 'contract.review.semantic', {
  module_id: 'contract_review',
  required_capabilities: ['text_generation', 'structured_output'],
})
const route = row('route-1', 'route_policy', 'review.assistant.default', {
  ai_application_id: 'review.assistant',
  model_catalog_entry_ids: ['model.primary'],
  strategy: 'ordered_fallback',
  timeout_ms: 120000,
  failure_action: 'manual_review',
})
const binding = row('binding-1', 'application_binding', 'contract.review.semantic.binding', {
  business_use_point_id: 'contract.review.semantic',
  ai_application_id: 'review.assistant',
})

describe('AI platform publish graph', () => {
  it('accepts the unique published chain from provider through business binding', () => {
    expect(validateAIPlatformReferences(primaryModel, [provider])).toEqual({ valid: true, reasons: [] })
    expect(validateAIPlatformReferences(route, [provider, primaryModel, application])).toEqual({ valid: true, reasons: [] })

    const bindingCandidate = row('binding-candidate', 'application_binding', 'contract.review.semantic.binding', {
      business_use_point_id: 'contract.review.semantic',
      ai_application_id: 'review.assistant',
    }, 'DRAFT')
    expect(validateAIPlatformReferences(bindingCandidate, [provider, primaryModel, application, usePoint, route]))
      .toEqual({ valid: true, reasons: [] })
  })

  it('rejects missing dependencies and model capability mismatches', () => {
    const weakModel = row('model-weak', 'model_catalog_entry', 'model.weak', {
      provider_connection_id: 'provider.cloud',
      model_id: 'vendor/weak',
      capabilities: ['text_generation'],
    })
    const invalidRoute = row('route-bad', 'route_policy', 'review.assistant.default', {
      ai_application_id: 'review.assistant',
      model_catalog_entry_ids: ['model.weak', 'model.missing'],
      strategy: 'ordered_fallback',
      timeout_ms: 120000,
      failure_action: 'manual_review',
    }, 'DRAFT')

    const result = validateAIPlatformReferences(invalidRoute, [provider, weakModel, application])
    expect(result.valid).toBe(false)
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('structured_output'),
      expect.stringContaining('model.missing'),
    ]))
  })

  it('rejects a free-form business use point that is not registered by product code', () => {
    const candidate = row('use-free', 'business_use_point', 'made.up.feature', {
      module_id: 'made_up',
      required_capabilities: ['text_generation'],
    }, 'DRAFT')

    expect(validateAIPlatformReferences(candidate, []).reasons)
      .toContain('业务用点未在产品代码中注册：made.up.feature')
  })

  it('does not let a disabled business use point bypass the code registry identity boundary', () => {
    const candidate = row('use-disabled-free', 'business_use_point', 'made.up.disabled', {
      module_id: 'made_up',
      required_capabilities: ['text_generation'],
      enabled: false,
    }, 'DRAFT')

    const result = validateAIPlatformPublishGraph(candidate, [])
    expect(result.valid).toBe(false)
    expect(result.reasons).toContain('业务用点未在产品代码中注册：made.up.disabled')
  })

  it('rejects a Provider revision that disables a node still consumed by a published model', () => {
    const disabledProvider = row('provider-revision', 'provider_connection', 'provider.cloud', {
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'none',
      base_url: 'https://provider.example/v1',
      connection_timeout_ms: 45000,
      enabled: false,
    }, 'DRAFT')

    const result = validateAIPlatformPublishGraph(disabledProvider, [
      provider,
      primaryModel,
      application,
      usePoint,
      route,
      binding,
    ])
    expect(result.valid).toBe(false)
    expect(result.reasons).toContain('模型必须引用已发布且启用的 Provider 连接：provider.cloud')
  })

  it('rejects a model revision that removes a capability required by an existing route', () => {
    const weakenedModel = row('model-revision', 'model_catalog_entry', 'model.primary', {
      provider_connection_id: 'provider.cloud',
      model_id: 'vendor/primary',
      capabilities: ['text_generation'],
    }, 'DRAFT')

    const result = validateAIPlatformPublishGraph(weakenedModel, [
      provider,
      primaryModel,
      application,
      usePoint,
      route,
      binding,
    ])
    expect(result.valid).toBe(false)
    expect(result.reasons.join('|')).toContain('structured_output')
  })

  it('rejects multiple enabled routes for one application and bindings for one use point', () => {
    const secondRoute = row('route-2', 'route_policy', 'review.assistant.secondary', {
      ai_application_id: 'review.assistant',
      model_catalog_entry_ids: ['model.primary'],
      strategy: 'ordered_fallback',
      timeout_ms: 120000,
      failure_action: 'manual_review',
    }, 'DRAFT')
    const routeResult = validateAIPlatformPublishGraph(secondRoute, [
      provider,
      primaryModel,
      application,
      route,
    ])
    expect(routeResult.reasons).toContain('AI 应用只能有一条已发布且启用的路由策略：review.assistant')

    const secondBinding = row('binding-2', 'application_binding', 'contract.review.semantic.other-binding', {
      business_use_point_id: 'contract.review.semantic',
      ai_application_id: 'review.assistant',
    }, 'DRAFT')
    const bindingResult = validateAIPlatformPublishGraph(secondBinding, [
      provider,
      primaryModel,
      application,
      usePoint,
      route,
      binding,
    ])
    expect(bindingResult.reasons).toContain('业务用点只能有一条已发布且启用的应用绑定：contract.review.semantic')
  })

  it('fails closed on malformed or duplicate published platform rows', () => {
    const malformed = row('bad-provider', 'provider_connection', 'provider.bad', {})
    const duplicateModel = row('model-duplicate', 'model_catalog_entry', 'model.primary', {
      provider_connection_id: 'provider.cloud',
      model_id: 'vendor/duplicate',
      capabilities: ['text_generation', 'structured_output'],
    })
    const candidate = row('app-candidate', 'ai_application', 'other.assistant', {
      capabilities: ['text_generation'],
    }, 'DRAFT')

    const result = validateAIPlatformPublishGraph(candidate, [
      malformed,
      provider,
      primaryModel,
      duplicateModel,
    ])
    expect(result.valid).toBe(false)
    expect(result.reasons.join('|')).toContain('结构无效')
    expect(result.reasons).toContain('发布图存在重复逻辑资产：model_catalog_entry:model.primary')
  })

  it('requires a real stored credential before publishing a bearer Provider', () => {
    const bearer = row('provider-bearer', 'provider_connection', 'provider.bearer', {
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'bearer',
      base_url: 'https://provider.example/v1',
      connection_timeout_ms: 45000,
    }, 'DRAFT')

    expect(validateAIPlatformPublishGraph(bearer, []).reasons)
      .toContain('Bearer Provider 必须保存真实凭据后才能发布：provider.bearer')
  })

  it('allows a masked bearer credential only in explicit presentation mode', () => {
    const maskedBearer = row('provider-bearer', 'provider_connection', 'provider.bearer', {
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: 'bearer',
      base_url: 'https://provider.example/v1',
      api_key: '****',
      connection_timeout_ms: 45000,
    }, 'DRAFT')

    expect(validateAIPlatformPublishGraph(maskedBearer, []).valid).toBe(false)
    expect(validateAIPlatformPublishGraph(maskedBearer, [], {
      allowMaskedCredentialForPresentation: true,
    })).toEqual({ valid: true, reasons: [] })
  })
})
