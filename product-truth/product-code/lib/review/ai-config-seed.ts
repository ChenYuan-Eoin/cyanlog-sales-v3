// REQ: F053
// PURPOSE: 报价审核 AI 助手六对象资产构造（business_use_point → ... → provider_connection）。
// 纯函数：构造资产供配置中心发布；compile 验证见测试；不直接写生产。
import { randomUUID } from 'node:crypto'
import type { AIExecutionPlanConfigRow } from '@/lib/ai/runtime-plan'

export interface QuoteReviewCloudProvider {
  baseUrl: string
  model: string
  apiKey?: string
}

export interface AIConfigAssetValue {
  schema_version: 'ai-platform.v1'
  asset_id: string
  enabled: boolean
  kind: string
  [key: string]: unknown
}

export function buildQuoteReviewAiAssets(cloud: QuoteReviewCloudProvider): AIConfigAssetValue[] {
  return [
    {
      schema_version: 'ai-platform.v1',
      asset_id: 'pc_quote_review_cloud',
      enabled: true,
      kind: 'provider_connection',
      provider_type: 'openai_compatible',
      runtime_location: 'cloud',
      auth_mode: cloud.apiKey ? 'bearer' : 'none',
      base_url: cloud.baseUrl.replace(/\/+$/, ''),
      ...(cloud.apiKey ? { api_key: cloud.apiKey } : {}),
      connection_timeout_ms: 30000,
    },
    {
      schema_version: 'ai-platform.v1',
      asset_id: 'mce_quote_review',
      enabled: true,
      kind: 'model_catalog_entry',
      provider_connection_id: 'pc_quote_review_cloud',
      model_id: cloud.model,
      capabilities: ['text_generation', 'structured_output'],
    },
    {
      schema_version: 'ai-platform.v1',
      asset_id: 'app_quote_review',
      enabled: true,
      kind: 'ai_application',
      capabilities: ['text_generation', 'structured_output'],
    },
    {
      schema_version: 'ai-platform.v1',
      asset_id: 'quote.review.assistant',
      enabled: true,
      kind: 'business_use_point',
      module_id: 'quote',
      required_capabilities: ['text_generation', 'structured_output'],
    },
    {
      schema_version: 'ai-platform.v1',
      asset_id: 'bind_quote_review',
      enabled: true,
      kind: 'application_binding',
      business_use_point_id: 'quote.review.assistant',
      ai_application_id: 'app_quote_review',
    },
    {
      schema_version: 'ai-platform.v1',
      asset_id: 'route_quote_review',
      enabled: true,
      kind: 'route_policy',
      ai_application_id: 'app_quote_review',
      model_catalog_entry_ids: ['mce_quote_review'],
      strategy: 'ordered_fallback',
      timeout_ms: 120000,
      failure_action: 'manual_review',
    },
  ]
}

export function assetValuesToConfigRows(values: AIConfigAssetValue[], orgId: string): AIExecutionPlanConfigRow[] {
  const names: Record<string, string> = {
    PC_QUOTE_REVIEW_CLOUD: '报价审核-云端连接',
    MCE_QUOTE_REVIEW: '报价审核-模型目录项',
    APP_QUOTE_REVIEW: '报价审核应用',
    'quote.review.assistant': '报价审核业务用点',
    BIND_QUOTE_REVIEW: '报价审核应用绑定',
    ROUTE_QUOTE_REVIEW: '报价审核路由策略',
  }
  return values.map((value) => ({
    id: randomUUID(),
    key: value.asset_id.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
    name: names[value.asset_id] ?? value.asset_id,
    value: value as unknown as Record<string, unknown>,
    type: 'AI_CONFIG',
    status: 'PUBLISHED',
    org_id: orgId,
  }))
}
