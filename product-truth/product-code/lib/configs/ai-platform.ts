import { getAIConfigKind, isAIPlatformAssetKind } from './ai-config-kind'
import { aiPlatformAssetValueSchema } from './validation'
import type {
  AIApplicationValue,
  AIPlatformAssetKind,
  AIPlatformAssetValue,
  ApplicationBindingValue,
  BusinessUsePointValue,
  ConfigStatus,
  ModelCatalogEntryValue,
  RoutePolicyValue,
} from './types'
import { getBusinessUsePointDefinition } from './ai-platform-registry'

export interface AIPlatformConfigLike {
  id?: string
  key: string
  name?: string
  status: ConfigStatus
  value: Record<string, unknown> | null | undefined
}

export interface AIPlatformReferenceValidation {
  valid: boolean
  reasons: string[]
}

export interface AIPlatformPublishGraphOptions {
  /**
   * Read APIs deliberately return a masked Provider credential. Presentation
   * code may opt in to treating that mask as evidence that a credential is
   * stored. Persistence and publish routes must keep the default strict mode.
   */
  allowMaskedCredentialForPresentation?: boolean
}

export function getAIAssetId(value: Record<string, unknown> | null | undefined): string | null {
  return typeof value?.asset_id === 'string' && value.asset_id.trim().length > 0
    ? value.asset_id.trim()
    : null
}

export function isAIPlatformAssetValue(
  value: Record<string, unknown> | null | undefined,
): value is Record<string, unknown> & AIPlatformAssetValue {
  return aiPlatformAssetValueSchema.safeParse(value).success
}

export function isEditableAIConfigValue(value: Record<string, unknown> | null | undefined): boolean {
  const kind = getAIConfigKind(value)
  return kind !== null && isAIPlatformAssetKind(kind)
}

export function isProviderCredentialValue(value: Record<string, unknown> | null | undefined): boolean {
  const kind = getAIConfigKind(value)
  return kind === 'provider' || kind === 'provider_connection'
}

export function sameLogicalAIAsset(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown> | null | undefined,
): boolean {
  const leftKind = getAIConfigKind(left)
  const rightKind = getAIConfigKind(right)
  if (leftKind !== rightKind) return false

  if (leftKind && isAIPlatformAssetKind(leftKind)) {
    return getAIAssetId(left) === getAIAssetId(right)
  }

  return leftKind === 'provider'
}

function publishedValue<T extends AIPlatformAssetValue>(
  map: Map<string, AIPlatformAssetValue>,
  kind: AIPlatformAssetKind,
  assetId: string,
): T | null {
  const value = map.get(`${kind}:${assetId}`)
  return value?.kind === kind ? value as T : null
}

function missingCapabilities(required: string[], available: string[]) {
  const supported = new Set(available)
  return required.filter((capability) => !supported.has(capability))
}

function isMaskedCredential(value: string): boolean {
  return value === '****'
    || value === '***'
    || /^[^*]{4}\*{3}[^*]{4}$/.test(value)
}

function looksLikeAIPlatformValue(value: Record<string, unknown> | null | undefined): boolean {
  return value?.schema_version === 'ai-platform.v1' || isAIPlatformAssetKind(value?.kind)
}

function rowLabel(row: AIPlatformConfigLike): string {
  return row.name ? `${row.name} (${row.key})` : row.key
}

function schemaReasons(row: AIPlatformConfigLike, issues: string[]): string[] {
  return issues.map((issue) => `已发布平台资产 ${rowLabel(row)} 结构无效：${issue}`)
}

/**
 * Build the complete virtual graph that would exist after publishing the
 * candidate. Every platform-shaped published row is parsed strictly. A
 * malformed row therefore closes the gate instead of being silently skipped.
 */
export function validateAIPlatformPublishGraph(
  candidate: AIPlatformConfigLike,
  existingRows: AIPlatformConfigLike[],
  options: AIPlatformPublishGraphOptions = {},
): AIPlatformReferenceValidation {
  if (!looksLikeAIPlatformValue(candidate.value)) {
    return { valid: true, reasons: [] }
  }

  const reasons: string[] = []
  const parsedCandidate = aiPlatformAssetValueSchema.safeParse(candidate.value)
  if (!parsedCandidate.success) {
    return {
      valid: false,
      reasons: schemaReasons(candidate, parsedCandidate.error.issues.map((issue) => (
        `${issue.path.join('.') || 'value'}: ${issue.message}`
      ))),
    }
  }

  const value = parsedCandidate.data as AIPlatformAssetValue
  const candidateLogicalKey = `${value.kind}:${value.asset_id}`
  const virtualRows: Array<{ row: AIPlatformConfigLike; value: AIPlatformAssetValue }> = []

  for (const row of existingRows) {
    if (row.status !== 'PUBLISHED' || row.id === candidate.id || !looksLikeAIPlatformValue(row.value)) continue
    const parsed = aiPlatformAssetValueSchema.safeParse(row.value)
    if (!parsed.success) {
      reasons.push(...schemaReasons(row, parsed.error.issues.map((issue) => (
        `${issue.path.join('.') || 'value'}: ${issue.message}`
      ))))
      continue
    }
    const parsedValue = parsed.data as AIPlatformAssetValue
    if (`${parsedValue.kind}:${parsedValue.asset_id}` === candidateLogicalKey) continue
    virtualRows.push({ row, value: parsedValue })
  }
  virtualRows.push({ row: { ...candidate, status: 'PUBLISHED' }, value })

  const allAssets = new Map<string, AIPlatformAssetValue>()
  for (const item of virtualRows) {
    const logicalKey = `${item.value.kind}:${item.value.asset_id}`
    if (allAssets.has(logicalKey)) {
      reasons.push(`发布图存在重复逻辑资产：${logicalKey}`)
      continue
    }
    allAssets.set(logicalKey, item.value)
  }

  const published = new Map(
    [...allAssets.entries()].filter(([, asset]) => asset.enabled === true),
  )

  // A BusinessUsePoint is a code-owned platform registration, not a free-form
  // dependency. Validate its identity even while disabled so an arbitrary
  // module/use-point pair cannot be parked as a seemingly valid published
  // asset and enabled later without passing the registry boundary.
  for (const asset of allAssets.values()) {
    if (asset.kind !== 'business_use_point') continue
    const usePoint = asset as BusinessUsePointValue
    const definition = getBusinessUsePointDefinition(usePoint.asset_id)
    if (!definition) {
      reasons.push(`业务用点未在产品代码中注册：${usePoint.asset_id}`)
      continue
    }
    if (definition.module_id !== usePoint.module_id) {
      reasons.push(`业务用点模块必须使用代码注册值：${definition.module_id}`)
    }
    const expected = [...definition.required_capabilities].sort()
    const actual = [...usePoint.required_capabilities].sort()
    if (expected.join('|') !== actual.join('|')) {
      reasons.push(`业务用点能力必须使用代码注册值：${expected.join('、')}`)
    }
  }

  const routeCounts = new Map<string, number>()
  const bindingCounts = new Map<string, number>()
  for (const asset of published.values()) {
    if (asset.kind === 'route_policy') {
      routeCounts.set(asset.ai_application_id, (routeCounts.get(asset.ai_application_id) || 0) + 1)
    }
    if (asset.kind === 'application_binding') {
      bindingCounts.set(
        asset.business_use_point_id,
        (bindingCounts.get(asset.business_use_point_id) || 0) + 1,
      )
    }
  }
  for (const [applicationId, count] of routeCounts) {
    if (count > 1) reasons.push(`AI 应用只能有一条已发布且启用的路由策略：${applicationId}`)
  }
  for (const [usePointId, count] of bindingCounts) {
    if (count > 1) reasons.push(`业务用点只能有一条已发布且启用的应用绑定：${usePointId}`)
  }

  for (const asset of published.values()) {
    if (asset.kind === 'provider_connection') {
      const authMode = asset.auth_mode ?? (asset.api_key ? 'bearer' : 'none')
      const maskedCredential = Boolean(asset.api_key && isMaskedCredential(asset.api_key))
      if (
        authMode === 'bearer'
        && (
          !asset.api_key
          || (maskedCredential && !options.allowMaskedCredentialForPresentation)
        )
      ) {
        reasons.push(`Bearer Provider 必须保存真实凭据后才能发布：${asset.asset_id}`)
      }
    }

    if (asset.kind === 'model_catalog_entry') {
      const model = asset as ModelCatalogEntryValue
      if (!publishedValue(published, 'provider_connection', model.provider_connection_id)) {
        reasons.push(`模型必须引用已发布且启用的 Provider 连接：${model.provider_connection_id}`)
      }
    }

    if (asset.kind === 'route_policy') {
      const route = asset as RoutePolicyValue
      const application = publishedValue<AIApplicationValue>(published, 'ai_application', route.ai_application_id)
      if (!application) {
        reasons.push(`路由必须引用已发布且启用的 AI 应用：${route.ai_application_id}`)
      }

      for (const modelId of route.model_catalog_entry_ids) {
        const model = publishedValue<ModelCatalogEntryValue>(published, 'model_catalog_entry', modelId)
        if (!model) {
          reasons.push(`路由候选必须是已发布且启用的模型：${modelId}`)
          continue
        }
        if (application) {
          const missing = missingCapabilities(application.capabilities, model.capabilities)
          if (missing.length > 0) {
            reasons.push(`模型 ${modelId} 缺少应用所需能力：${missing.join('、')}`)
          }
        }
      }
    }

    if (asset.kind === 'application_binding') {
      const binding = asset as ApplicationBindingValue
      const usePoint = publishedValue<BusinessUsePointValue>(
        published,
        'business_use_point',
        binding.business_use_point_id,
      )
      const application = publishedValue<AIApplicationValue>(
        published,
        'ai_application',
        binding.ai_application_id,
      )
      if (!usePoint) {
        reasons.push(`绑定必须引用已发布且启用的业务用点：${binding.business_use_point_id}`)
      }
      if (!application) {
        reasons.push(`绑定必须引用已发布且启用的 AI 应用：${binding.ai_application_id}`)
      }
      if (usePoint && application) {
        const missing = missingCapabilities(usePoint.required_capabilities, application.capabilities)
        if (missing.length > 0) {
          reasons.push(`AI 应用缺少业务用点所需能力：${missing.join('、')}`)
        }
        if ((routeCounts.get(binding.ai_application_id) || 0) !== 1) {
          reasons.push(`绑定的 AI 应用必须且只能有一条已发布且启用的路由策略：${binding.ai_application_id}`)
        }
      }
    }
  }

  return { valid: reasons.length === 0, reasons }
}

export function validateAIPlatformReferences(
  candidate: AIPlatformConfigLike,
  existingRows: AIPlatformConfigLike[],
): AIPlatformReferenceValidation {
  return validateAIPlatformPublishGraph(candidate, existingRows)
}

export function logicalAIAssetKey(value: Record<string, unknown> | null | undefined): string | null {
  const kind = getAIConfigKind(value)
  if (!kind) return null
  if (isAIPlatformAssetKind(kind)) {
    const assetId = getAIAssetId(value)
    return assetId ? `${kind}:${assetId}` : null
  }
  return null
}
