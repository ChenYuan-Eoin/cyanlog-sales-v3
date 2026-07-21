import { createHash } from 'node:crypto'

import { getBusinessUsePointDefinition } from '@/lib/configs/ai-platform-registry'
import type {
  AIApplicationValue,
  AIPlatformAssetKind,
  AIPlatformAssetValue,
  ApplicationBindingValue,
  BusinessUsePointValue,
  ConfigStatus,
  ModelCatalogEntryValue,
  ProviderConnectionValue,
  RoutePolicyValue,
} from '@/lib/configs/types'
import { aiPlatformAssetValueSchema } from '@/lib/configs/validation'

type JsonRecord = Record<string, unknown>

const AI_PLATFORM_KINDS = new Set<AIPlatformAssetKind>([
  'provider_connection',
  'model_catalog_entry',
  'ai_application',
  'business_use_point',
  'application_binding',
  'route_policy',
])

const MASKED_CREDENTIALS = new Set(['***', '****'])

export type AIExecutionEnvironment = 'local' | 'hosted'

export interface AIExecutionPlanConfigRow {
  id: string
  key: string
  name?: string
  value: JsonRecord | null
  type: string
  status: ConfigStatus
  org_id?: string | null
  updated_at?: string
}

interface ConfigIdentity {
  configId: string
  configKey: string
  assetId: string
}

export interface AIExecutionCandidate {
  /** Zero-based order within the candidates executable in this environment. */
  readonly position: number
  readonly modelConfigId: string
  readonly modelConfigKey: string
  readonly modelAssetId: string
  readonly modelId: string
  readonly capabilities: readonly string[]
  readonly contextWindow?: number
  readonly providerConfigId: string
  readonly providerConfigKey: string
  readonly providerAssetId: string
  readonly providerType: 'openai_compatible'
  readonly endpoint: string
  readonly runtimeLocation: 'local' | 'cloud'
  readonly authMode: 'none' | 'bearer'
  readonly connectionTimeoutMs: number
  /**
   * Runtime-only secret. It is deliberately non-enumerable, excluded from the
   * snapshot and excluded from the hash so normal serialization cannot leak it.
   */
  readonly credential?: string
}

export interface AIExecutionPlanSnapshotCandidate {
  readonly position: number
  readonly model: ConfigIdentity & {
    readonly modelId: string
    readonly capabilities: readonly string[]
    readonly contextWindow?: number
  }
  readonly provider: ConfigIdentity & {
    readonly providerType: 'openai_compatible'
    readonly endpoint: string
    readonly runtimeLocation: 'local' | 'cloud'
    readonly authMode: 'none' | 'bearer'
    readonly credentialState: 'not_required' | 'stored'
    readonly connectionTimeoutMs: number
  }
}

export interface AIExecutionPlanSnapshot {
  readonly schemaVersion: 'ai-runtime-plan.v1'
  readonly orgId: string
  readonly executionEnvironment: AIExecutionEnvironment
  readonly usePoint: ConfigIdentity & {
    readonly moduleId: string
    readonly requiredCapabilities: readonly string[]
  }
  readonly binding: ConfigIdentity & {
    readonly usePointId: string
    readonly applicationId: string
  }
  readonly application: ConfigIdentity & {
    readonly capabilities: readonly string[]
  }
  readonly route: ConfigIdentity & {
    readonly strategy: 'ordered_fallback'
    readonly timeoutMs: number
    readonly failureAction: 'manual_review' | 'stop'
    /** Published administrator configuration, preserved even when an environment cannot execute every item. */
    readonly orderedModelAssetIds: readonly string[]
    /** Actual environment projection. Optional only so historical v1 snapshots remain readable. */
    readonly effectiveOrderedModelAssetIds?: readonly string[]
  }
  readonly candidates: readonly AIExecutionPlanSnapshotCandidate[]
}

export interface AIExecutionPlan {
  readonly orgId: string
  readonly executionEnvironment: AIExecutionEnvironment
  readonly usePointId: string
  readonly usePointConfigId: string
  readonly applicationId: string
  readonly applicationConfigId: string
  readonly routeId: string
  readonly routeConfigId: string
  readonly failureAction: 'manual_review' | 'stop'
  readonly timeoutMs: number
  readonly candidates: readonly AIExecutionCandidate[]
  readonly snapshot: AIExecutionPlanSnapshot
  readonly snapshotHash: string
}

export type AIExecutionPlanErrorCode =
  | 'INVALID_REQUEST'
  | 'MALFORMED_PLATFORM_ASSET'
  | 'UNPUBLISHED_PLATFORM_ASSET'
  | 'DUPLICATE_LOGICAL_ASSET'
  | 'USE_POINT_NOT_FOUND'
  | 'USE_POINT_DISABLED'
  | 'USE_POINT_REGISTRY_MISMATCH'
  | 'BINDING_NOT_FOUND'
  | 'BINDING_DISABLED'
  | 'BINDING_AMBIGUOUS'
  | 'APPLICATION_NOT_FOUND'
  | 'APPLICATION_DISABLED'
  | 'APPLICATION_CAPABILITY_MISMATCH'
  | 'ROUTE_NOT_FOUND'
  | 'ROUTE_DISABLED'
  | 'ROUTE_AMBIGUOUS'
  | 'EMPTY_ROUTE'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_DISABLED'
  | 'MODEL_CAPABILITY_MISMATCH'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_CREDENTIAL_MISSING'
  | 'RUNTIME_LOCATION_INCOMPATIBLE'

export class AIExecutionPlanError extends Error {
  constructor(
    public readonly code: AIExecutionPlanErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'AIExecutionPlanError'
  }
}

interface ParsedPlatformRow<T extends AIPlatformAssetValue = AIPlatformAssetValue> {
  row: AIExecutionPlanConfigRow
  value: T
}

export interface CompilePublishedAIExecutionPlanInput {
  orgId: string
  usePointId: string
  executionEnvironment: AIExecutionEnvironment
  rows: readonly AIExecutionPlanConfigRow[]
}

export type PublishedAIConfigLoader = (
  orgId: string,
) => Promise<readonly AIExecutionPlanConfigRow[]>

export interface ResolvePublishedAIExecutionPlanInput {
  orgId: string
  usePointId: string
  executionEnvironment: AIExecutionEnvironment
  /** Supplying rows keeps callers/tests on the pure compiler path. */
  rows?: readonly AIExecutionPlanConfigRow[]
  /** Optional dependency injection; the default loads PUBLISHED AI_CONFIG rows. */
  loadPublishedConfigs?: PublishedAIConfigLoader
}

function fail(
  code: AIExecutionPlanErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new AIExecutionPlanError(code, message, details)
}

function looksLikePlatformAsset(value: JsonRecord | null): boolean {
  return value?.schema_version === 'ai-platform.v1'
    || (typeof value?.kind === 'string' && AI_PLATFORM_KINDS.has(value.kind as AIPlatformAssetKind))
}

function logicalKey(value: AIPlatformAssetValue): string {
  return `${value.kind}:${value.asset_id}`
}

function parsePublishedPlatformRows(
  rows: readonly AIExecutionPlanConfigRow[],
  orgId: string,
): Map<string, ParsedPlatformRow> {
  const parsed = new Map<string, ParsedPlatformRow>()

  for (const row of rows) {
    if (!looksLikePlatformAsset(row.value)) continue

    if (row.type !== 'AI_CONFIG' || row.status !== 'PUBLISHED') {
      fail(
        'UNPUBLISHED_PLATFORM_ASSET',
        `AI 运行计划只能读取已发布 AI_CONFIG：${row.key}`,
        { configId: row.id, type: row.type, status: row.status },
      )
    }
    if (row.org_id && row.org_id !== orgId) {
      fail('INVALID_REQUEST', `配置不属于请求组织：${row.key}`, {
        configId: row.id,
        expectedOrgId: orgId,
      })
    }

    const result = aiPlatformAssetValueSchema.safeParse(row.value)
    if (!result.success) {
      fail(
        'MALFORMED_PLATFORM_ASSET',
        `已发布 AI 平台资产结构无效：${row.key}`,
        {
          configId: row.id,
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join('.') || 'value',
            message: issue.message,
          })),
        },
      )
    }

    const value = result.data as AIPlatformAssetValue
    const key = logicalKey(value)
    if (parsed.has(key)) {
      fail('DUPLICATE_LOGICAL_ASSET', `已发布 AI 平台逻辑资产重复：${key}`, {
        logicalKey: key,
        configIds: [parsed.get(key)?.row.id, row.id],
      })
    }
    parsed.set(key, { row, value })
  }

  return parsed
}

function getAsset<T extends AIPlatformAssetValue>(
  assets: Map<string, ParsedPlatformRow>,
  kind: T['kind'],
  assetId: string,
  missingCode: AIExecutionPlanErrorCode,
  disabledCode: AIExecutionPlanErrorCode,
): ParsedPlatformRow<T> {
  const item = assets.get(`${kind}:${assetId}`)
  if (!item || item.value.kind !== kind) {
    fail(missingCode, `找不到已发布 ${kind}：${assetId}`, { kind, assetId })
  }
  if (!item.value.enabled) {
    fail(disabledCode, `AI 运行计划不能消费已停用 ${kind}：${assetId}`, { kind, assetId })
  }
  return item as ParsedPlatformRow<T>
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function missingCapabilities(required: readonly string[], available: readonly string[]): string[] {
  const supported = new Set(available)
  return required.filter((capability) => !supported.has(capability))
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return sortedUnique(left).join('\u0000') === sortedUnique(right).join('\u0000')
}

function identity(item: ParsedPlatformRow): ConfigIdentity {
  return {
    configId: item.row.id,
    configKey: item.row.key,
    assetId: item.value.asset_id,
  }
}

function effectiveAuthMode(provider: ProviderConnectionValue): 'none' | 'bearer' {
  return provider.auth_mode ?? (provider.api_key ? 'bearer' : 'none')
}

function isUsableCredential(value: string | undefined): value is string {
  return Boolean(
    value
    && value.trim().length >= 4
    && !MASKED_CREDENTIALS.has(value)
    && !/^[^*]{4}\*{3}[^*]{4}$/.test(value),
  )
}

function withNonEnumerableCredential(
  candidate: Omit<AIExecutionCandidate, 'credential'>,
  credential: string | undefined,
): AIExecutionCandidate {
  const result = { ...candidate } as AIExecutionCandidate
  if (credential !== undefined) {
    Object.defineProperty(result, 'credential', {
      value: credential,
      enumerable: false,
      writable: false,
      configurable: false,
    })
  }
  return result
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

export function stableAIExecutionPlanSnapshotJson(snapshot: AIExecutionPlanSnapshot): string {
  return JSON.stringify(canonicalize(snapshot))
}

export function hashAIExecutionPlanSnapshot(snapshot: AIExecutionPlanSnapshot): string {
  return createHash('sha256').update(stableAIExecutionPlanSnapshotJson(snapshot)).digest('hex')
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Reflect.ownKeys(value as object)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key])
  }
  return Object.freeze(value)
}

/**
 * Compile one strict, immutable six-object execution plan. This pure boundary
 * never reads environment variables and never considers the legacy ModelPolicy.
 */
export function compilePublishedAIExecutionPlan(
  input: CompilePublishedAIExecutionPlanInput,
): AIExecutionPlan {
  const orgId = input.orgId.trim()
  const usePointId = input.usePointId.trim()
  if (!orgId || !usePointId) {
    fail('INVALID_REQUEST', 'orgId 与 usePointId 不能为空')
  }

  const assets = parsePublishedPlatformRows(input.rows, orgId)
  const usePoint = getAsset<BusinessUsePointValue>(
    assets,
    'business_use_point',
    usePointId,
    'USE_POINT_NOT_FOUND',
    'USE_POINT_DISABLED',
  )
  const registryDefinition = getBusinessUsePointDefinition(usePointId)
  if (
    !registryDefinition
    || registryDefinition.module_id !== usePoint.value.module_id
    || !sameStringSet(registryDefinition.required_capabilities, usePoint.value.required_capabilities)
  ) {
    fail('USE_POINT_REGISTRY_MISMATCH', `业务用点与代码注册事实不一致：${usePointId}`, {
      usePointId,
      configuredModuleId: usePoint.value.module_id,
      registeredModuleId: registryDefinition?.module_id ?? null,
    })
  }

  const allBindings = [...assets.values()].filter((item): item is ParsedPlatformRow<ApplicationBindingValue> => (
    item.value.kind === 'application_binding'
    && item.value.business_use_point_id === usePointId
  ))
  const enabledBindings = allBindings.filter((item) => item.value.enabled)
  if (enabledBindings.length === 0) {
    if (allBindings.length > 0) {
      fail('BINDING_DISABLED', `业务用点的应用绑定已停用：${usePointId}`, { usePointId })
    }
    fail('BINDING_NOT_FOUND', `业务用点没有已发布应用绑定：${usePointId}`, { usePointId })
  }
  if (enabledBindings.length !== 1) {
    fail('BINDING_AMBIGUOUS', `业务用点存在多条已发布启用绑定：${usePointId}`, {
      usePointId,
      bindingIds: enabledBindings.map((item) => item.value.asset_id),
    })
  }
  const binding = enabledBindings[0]

  const application = getAsset<AIApplicationValue>(
    assets,
    'ai_application',
    binding.value.ai_application_id,
    'APPLICATION_NOT_FOUND',
    'APPLICATION_DISABLED',
  )
  const applicationMissing = missingCapabilities(
    usePoint.value.required_capabilities,
    application.value.capabilities,
  )
  if (applicationMissing.length > 0) {
    fail(
      'APPLICATION_CAPABILITY_MISMATCH',
      `AI 应用缺少业务用点能力：${applicationMissing.join('、')}`,
      { applicationId: application.value.asset_id, missingCapabilities: applicationMissing },
    )
  }

  const allRoutes = [...assets.values()].filter((item): item is ParsedPlatformRow<RoutePolicyValue> => (
    item.value.kind === 'route_policy'
    && item.value.ai_application_id === application.value.asset_id
  ))
  const enabledRoutes = allRoutes.filter((item) => item.value.enabled)
  if (enabledRoutes.length === 0) {
    if (allRoutes.length > 0) {
      fail('ROUTE_DISABLED', `AI 应用的路由策略已停用：${application.value.asset_id}`, {
        applicationId: application.value.asset_id,
      })
    }
    fail('ROUTE_NOT_FOUND', `AI 应用没有已发布路由策略：${application.value.asset_id}`, {
      applicationId: application.value.asset_id,
    })
  }
  if (enabledRoutes.length !== 1) {
    fail('ROUTE_AMBIGUOUS', `AI 应用存在多条已发布启用路由：${application.value.asset_id}`, {
      applicationId: application.value.asset_id,
      routeIds: enabledRoutes.map((item) => item.value.asset_id),
    })
  }
  const route = enabledRoutes[0]
  if (route.value.model_catalog_entry_ids.length === 0) {
    fail('EMPTY_ROUTE', `路由没有模型候选：${route.value.asset_id}`, { routeId: route.value.asset_id })
  }

  const configuredCandidateSources = route.value.model_catalog_entry_ids.map((modelAssetId) => {
    const model = getAsset<ModelCatalogEntryValue>(
      assets,
      'model_catalog_entry',
      modelAssetId,
      'MODEL_NOT_FOUND',
      'MODEL_DISABLED',
    )
    const modelMissing = missingCapabilities(application.value.capabilities, model.value.capabilities)
    if (modelMissing.length > 0) {
      fail(
        'MODEL_CAPABILITY_MISMATCH',
        `模型缺少 AI 应用能力：${modelMissing.join('、')}`,
        { modelAssetId, missingCapabilities: modelMissing },
      )
    }

    const provider = getAsset<ProviderConnectionValue>(
      assets,
      'provider_connection',
      model.value.provider_connection_id,
      'PROVIDER_NOT_FOUND',
      'PROVIDER_DISABLED',
    )
    return { model, provider }
  })

  const excludedLocalSources = input.executionEnvironment === 'hosted'
    ? configuredCandidateSources.filter(({ provider }) => provider.value.runtime_location === 'local')
    : []
  const executableSources = input.executionEnvironment === 'hosted'
    ? configuredCandidateSources.filter(({ provider }) => provider.value.runtime_location !== 'local')
    : configuredCandidateSources

  if (executableSources.length === 0) {
    fail(
      'RUNTIME_LOCATION_INCOMPATIBLE',
      `当前环境没有可执行模型：${route.value.asset_id}`,
      {
        routeId: route.value.asset_id,
        executionEnvironment: input.executionEnvironment,
        excludedModelAssetIds: excludedLocalSources.map(({ model }) => model.value.asset_id),
        excludedProviderAssetIds: sortedUnique(
          excludedLocalSources.map(({ provider }) => provider.value.asset_id),
        ),
      },
    )
  }

  // Credentials belong to the effective runtime path. A hosted execution must
  // not fail because a local-only candidate (which it will never call) has no
  // usable credential.
  const candidateSources = executableSources.map(({ model, provider }, position) => {
    const authMode = effectiveAuthMode(provider.value)
    if (authMode === 'bearer' && !isUsableCredential(provider.value.api_key)) {
      fail('PROVIDER_CREDENTIAL_MISSING', `Bearer Provider 没有真实凭据：${provider.value.asset_id}`, {
        providerAssetId: provider.value.asset_id,
      })
    }

    return { position, model, provider, authMode }
  })

  const candidates = candidateSources.map(({ position, model, provider, authMode }) => (
    withNonEnumerableCredential({
      position,
      modelConfigId: model.row.id,
      modelConfigKey: model.row.key,
      modelAssetId: model.value.asset_id,
      modelId: model.value.model_id,
      capabilities: sortedUnique(model.value.capabilities),
      contextWindow: model.value.context_window,
      providerConfigId: provider.row.id,
      providerConfigKey: provider.row.key,
      providerAssetId: provider.value.asset_id,
      providerType: provider.value.provider_type,
      endpoint: provider.value.base_url,
      runtimeLocation: provider.value.runtime_location,
      authMode,
      connectionTimeoutMs: provider.value.connection_timeout_ms,
    }, authMode === 'bearer' ? provider.value.api_key : undefined)
  ))

  const snapshot: AIExecutionPlanSnapshot = {
    schemaVersion: 'ai-runtime-plan.v1',
    orgId,
    executionEnvironment: input.executionEnvironment,
    usePoint: {
      ...identity(usePoint),
      moduleId: usePoint.value.module_id,
      requiredCapabilities: sortedUnique(usePoint.value.required_capabilities),
    },
    binding: {
      ...identity(binding),
      usePointId: binding.value.business_use_point_id,
      applicationId: binding.value.ai_application_id,
    },
    application: {
      ...identity(application),
      capabilities: sortedUnique(application.value.capabilities),
    },
    route: {
      ...identity(route),
      strategy: route.value.strategy,
      timeoutMs: route.value.timeout_ms,
      failureAction: route.value.failure_action,
      orderedModelAssetIds: [...route.value.model_catalog_entry_ids],
      effectiveOrderedModelAssetIds: candidateSources.map(({ model }) => model.value.asset_id),
    },
    candidates: candidateSources.map(({ position, model, provider, authMode }) => ({
      position,
      model: {
        ...identity(model),
        modelId: model.value.model_id,
        capabilities: sortedUnique(model.value.capabilities),
        contextWindow: model.value.context_window,
      },
      provider: {
        ...identity(provider),
        providerType: provider.value.provider_type,
        endpoint: provider.value.base_url,
        runtimeLocation: provider.value.runtime_location,
        authMode,
        credentialState: authMode === 'bearer' ? 'stored' : 'not_required',
        connectionTimeoutMs: provider.value.connection_timeout_ms,
      },
    })),
  }

  const frozenSnapshot = deepFreeze(snapshot)
  const plan: AIExecutionPlan = {
    orgId,
    executionEnvironment: input.executionEnvironment,
    usePointId: usePoint.value.asset_id,
    usePointConfigId: usePoint.row.id,
    applicationId: application.value.asset_id,
    applicationConfigId: application.row.id,
    routeId: route.value.asset_id,
    routeConfigId: route.row.id,
    failureAction: route.value.failure_action,
    timeoutMs: route.value.timeout_ms,
    candidates,
    snapshot: frozenSnapshot,
    snapshotHash: hashAIExecutionPlanSnapshot(frozenSnapshot),
  }

  return deepFreeze(plan)
}

async function defaultPublishedAIConfigLoader(orgId: string): Promise<readonly AIExecutionPlanConfigRow[]> {
  const { listPublishedConfigsByType } = await import('@/lib/configs/runtime')
  return listPublishedConfigsByType('AI_CONFIG', orgId)
}

/**
 * Resolve the plan from supplied rows or the sole PUBLISHED AI_CONFIG loader.
 * There is intentionally no environment-variable or legacy-policy fallback.
 */
export async function resolvePublishedAIExecutionPlan(
  input: ResolvePublishedAIExecutionPlanInput,
): Promise<AIExecutionPlan> {
  const loader = input.loadPublishedConfigs ?? defaultPublishedAIConfigLoader
  const rows = input.rows ?? await loader(input.orgId)
  return compilePublishedAIExecutionPlan({
    orgId: input.orgId,
    usePointId: input.usePointId,
    executionEnvironment: input.executionEnvironment,
    rows,
  })
}
