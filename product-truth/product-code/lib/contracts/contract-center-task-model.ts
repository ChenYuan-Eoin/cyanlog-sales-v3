import { CONTRACT_SOURCE_FORMAT_LABEL } from './contract-source-readiness'

export type ContractCenterTaskId =
  | 'draft_contract'
  | 'start_review'
  | 'continue_review'
  | 'compare_versions'

export type ContractCenterTaskAvailability =
  | 'available'
  | 'needs_input'
  | 'in_progress'
  | 'blocked'

export type ContractCenterVersionKind = 'source' | 'output'

export type ContractCenterVersionInput = {
  id: string
  versionNumber?: number | null
  source?: string | null
  kind?: ContractCenterVersionKind | null
  storagePath?: string | null
  createdAt?: string | null
}

export type ContractCenterReviewRunInput = {
  id: string
  status?: string | null
  sourceBinding?: ContractCenterReviewSourceBinding | null
  sourceVersionId?: string | null
  sourceStoragePath?: string | null
  createdAt?: string | null
  completedAt?: string | null
  exportReady?: boolean | null
}

export type ContractCenterSourceIdentityInput = {
  state?: 'ready' | 'preparing' | 'waiting_ocr' | 'waiting_conversion' | 'failed' | 'missing' | string | null
  ready?: boolean | null
  sourceVersionId?: string | null
  storagePath?: string | null
  failureReason?: string | null
}

export type ContractCenterTaskModelInput = {
  contract?: {
    id: string
    name?: string | null
  } | null
  versions?: ContractCenterVersionInput[] | null
  reviewRuns?: ContractCenterReviewRunInput[] | null
  latestReviewRun?: ContractCenterReviewRunInput | null
  currentSourceVersionId?: string | null
  currentSourceStoragePath?: string | null
  sourceIdentity?: ContractCenterSourceIdentityInput | null
}

export type ContractCenterSourceIdentityState =
  | 'not_applicable'
  | 'missing'
  | 'preparing'
  | 'waiting_ocr'
  | 'waiting_conversion'
  | 'failed'
  | 'stale'
  | 'ready'

export type ContractCenterSourceIdentityReadiness = {
  state: ContractCenterSourceIdentityState
  label: string
  description: string
  ready: boolean
  canStartReview: boolean
}

export type ContractCenterCurrentSourceResolution = {
  state: 'none' | 'explicit_version' | 'explicit_path' | 'latest_source_version' | 'conflict'
  description: string
}

export type ContractCenterReviewSourceBinding =
  | 'matched_source_version'
  | 'points_to_output_version'
  | 'unresolved'

export type ContractCenterResolvedReviewRun = {
  id: string
  status: string
  statusLabel: string
  sourceBinding: ContractCenterReviewSourceBinding
  sourceVersion: ContractCenterVersionInput | null
  sourceVersionLabel: string
  isForCurrentSource: boolean
  exportReady: boolean
  createdAt: string | null
  completedAt: string | null
}

export type ContractCenterComparisonReadiness = {
  state: 'no_contract' | 'no_source_version' | 'needs_second_version' | 'ready'
  label: string
  description: string
  canStartComparison: boolean
  sourceVersionCount: number
}

export type ContractCenterBusinessTask = {
  id: ContractCenterTaskId
  availability: ContractCenterTaskAvailability
  availabilityLabel: string
  label: string
  objectLabel: string
  preconditionLabel: string
  href: string | null
  nextAction: {
    id: string
    label: string
    description: string
  }
  blockedReason: string | null
}

export type ContractCenterTaskModel = {
  sourceVersions: ContractCenterVersionInput[]
  outputVersions: ContractCenterVersionInput[]
  currentSourceVersion: ContractCenterVersionInput | null
  currentSourceVersionLabel: string
  currentSourceResolution: ContractCenterCurrentSourceResolution
  sourceIdentity: ContractCenterSourceIdentityReadiness
  reviewRuns: ContractCenterResolvedReviewRun[]
  latestReview: ContractCenterResolvedReviewRun | null
  currentReview: ContractCenterResolvedReviewRun | null
  latestHistoricalReview: ContractCenterResolvedReviewRun | null
  comparison: ContractCenterComparisonReadiness
  tasks: Record<ContractCenterTaskId, ContractCenterBusinessTask>
  taskOrder: ContractCenterTaskId[]
}

const OUTPUT_VERSION_SOURCES = new Set([
  'review_revision',
  'output',
  'annotated',
  'annotated_document',
  'generated_output',
])

const SOURCE_VERSION_SOURCES = new Set([
  'original',
  'manual_revision',
  'customer_return',
  'customer_revision',
  'source',
])

export const CONTRACT_CENTER_TASK_ORDER: ContractCenterTaskId[] = [
  'draft_contract',
  'start_review',
  'continue_review',
  'compare_versions',
]

function normalizedText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizedSource(value: string | null | undefined) {
  return normalizedText(value).toLowerCase().replace(/[-\s]+/g, '_')
}

function numericTimestamp(value: string | null | undefined) {
  const timestamp = Date.parse(normalizedText(value))
  return Number.isFinite(timestamp) ? timestamp : 0
}

function normalizedVersionNumber(version: ContractCenterVersionInput) {
  const value = Number(version.versionNumber)
  return Number.isFinite(value) ? value : 0
}

function sortVersionsNewestFirst(versions: ContractCenterVersionInput[]) {
  return [...versions].sort((left, right) => {
    const versionDifference = normalizedVersionNumber(right) - normalizedVersionNumber(left)
    if (versionDifference !== 0) return versionDifference
    return numericTimestamp(right.createdAt) - numericTimestamp(left.createdAt)
  })
}

function versionKind(version: ContractCenterVersionInput): ContractCenterVersionKind | null {
  const source = normalizedSource(version.source)
  if (OUTPUT_VERSION_SOURCES.has(source)) return 'output'
  if (version.kind === 'source' || version.kind === 'output') return version.kind
  if (SOURCE_VERSION_SOURCES.has(source)) return 'source'
  return null
}

function versionLabel(version: ContractCenterVersionInput | null) {
  if (!version) return '文件版本待核对'
  const number = normalizedVersionNumber(version)
  return number > 0 ? `v${number}` : '已登记源版本'
}

function sameStoragePath(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizedText(left)
  const normalizedRight = normalizedText(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

function pickCurrentSourceVersion(
  sourceVersions: ContractCenterVersionInput[],
  input: ContractCenterTaskModelInput
): {
  version: ContractCenterVersionInput | null
  resolution: ContractCenterCurrentSourceResolution
} {
  const explicitId = normalizedText(input.currentSourceVersionId)
  const explicitPath = normalizedText(input.currentSourceStoragePath)
  if (explicitId) {
    const explicitVersion = sourceVersions.find((version) => version.id === explicitId)
    if (explicitVersion && (!explicitPath || sameStoragePath(explicitVersion.storagePath, explicitPath))) {
      return {
        version: explicitVersion,
        resolution: {
          state: 'explicit_version',
          description: '当前文件已与登记的源版本一致。',
        },
      }
    }
    return {
      version: null,
      resolution: {
        state: 'conflict',
        description: '当前文件指向的版本不在源版本列表中，需要先核对文件归属。',
      },
    }
  }

  if (explicitPath) {
    const pathVersion = sourceVersions.find((version) => sameStoragePath(version.storagePath, explicitPath))
    if (pathVersion) {
      return {
        version: pathVersion,
        resolution: {
          state: 'explicit_path',
          description: '当前文件已与登记的源版本一致。',
        },
      }
    }
    return {
      version: null,
      resolution: {
        state: 'conflict',
        description: '当前文件与源版本列表不一致，需要先核对文件归属。',
      },
    }
  }

  if (sourceVersions[0]) {
    return {
      version: sourceVersions[0],
      resolution: {
        state: 'latest_source_version',
        description: '未提供当前文件指针，暂按最新登记的源版本展示。',
      },
    }
  }

  return {
    version: null,
    resolution: {
      state: 'none',
      description: '当前合同还没有源文件版本。',
    },
  }
}

function reviewTimestamp(review: ContractCenterReviewRunInput) {
  return numericTimestamp(review.createdAt) || numericTimestamp(review.completedAt)
}

function reviewCandidates(input: ContractCenterTaskModelInput) {
  const byId = new Map<string, ContractCenterReviewRunInput>()
  // The full collection is canonical when available. `latestReviewRun` is only
  // a compatibility fallback and must not shadow a richer row with the same id.
  for (const review of [...(input.reviewRuns || []), input.latestReviewRun]) {
    const id = normalizedText(review?.id)
    if (id && review && !byId.has(id)) byId.set(id, review)
  }
  return [...byId.values()].sort((left, right) => reviewTimestamp(right) - reviewTimestamp(left))
}

function resolveReviewSourceVersion(
  review: ContractCenterReviewRunInput,
  sourceVersions: ContractCenterVersionInput[],
  outputVersions: ContractCenterVersionInput[]
) {
  if (review.sourceBinding === 'unresolved' || review.sourceBinding === 'points_to_output_version') {
    return {
      sourceBinding: review.sourceBinding,
      sourceVersion: null,
    }
  }

  const sourceVersionId = normalizedText(review.sourceVersionId)
  const sourceStoragePath = normalizedText(review.sourceStoragePath)

  const sourceById = sourceVersionId
    ? sourceVersions.find((version) => version.id === sourceVersionId) || null
    : null
  const sourceByPath = sourceStoragePath
    ? sourceVersions.find((version) => sameStoragePath(version.storagePath, sourceStoragePath)) || null
    : null
  const outputById = sourceVersionId
    ? outputVersions.find((version) => version.id === sourceVersionId) || null
    : null
  const outputByPath = sourceStoragePath
    ? outputVersions.find((version) => sameStoragePath(version.storagePath, sourceStoragePath)) || null
    : null

  const hasConflictingReferences = Boolean(
    (sourceVersionId && sourceStoragePath && sourceById?.id !== sourceByPath?.id)
    || (sourceVersionId && sourceStoragePath && outputById?.id !== outputByPath?.id)
    || ((sourceById || sourceByPath) && (outputById || outputByPath))
  )
  if (hasConflictingReferences) {
    return {
      sourceBinding: 'unresolved' as const,
      sourceVersion: null,
    }
  }

  const matchedSource = sourceById || sourceByPath
  if (matchedSource) {
    return {
      sourceBinding: 'matched_source_version' as const,
      sourceVersion: matchedSource,
    }
  }

  const matchedOutput = outputById || outputByPath
  if (matchedOutput) {
    return {
      sourceBinding: 'points_to_output_version' as const,
      sourceVersion: null,
    }
  }

  return {
    sourceBinding: 'unresolved' as const,
    sourceVersion: null,
  }
}

function reviewStatusCategory(status: string) {
  const normalized = normalizedSource(status)
  if (['pending', 'queued', 'created', 'parsing', 'analyzing', 'processing', 'running'].includes(normalized)) {
    return 'running' as const
  }
  if (['failed', 'error', 'cancelled', 'canceled'].includes(normalized)) {
    return 'failed' as const
  }
  if (['degraded', 'needs_review', 'needs_manual_review'].includes(normalized)) {
    return 'degraded' as const
  }
  if (['completed', 'succeeded', 'success', 'done'].includes(normalized)) {
    return 'completed' as const
  }
  return 'unknown' as const
}

function reviewStatusLabel(status: string, exportReady = false) {
  const category = reviewStatusCategory(status)
  if (category === 'running') return '审核进行中'
  if (category === 'failed') return '审核未完成'
  if (category === 'degraded') return '审核降级，需人工复核'
  if (category === 'completed') return exportReady ? '审核交付已就绪' : '风险结果待处理'
  return '审核状态待确认'
}

function resolveReviewRuns(
  input: ContractCenterTaskModelInput,
  sourceVersions: ContractCenterVersionInput[],
  outputVersions: ContractCenterVersionInput[],
  currentSourceVersion: ContractCenterVersionInput | null
): ContractCenterResolvedReviewRun[] {
  return reviewCandidates(input).map((review) => {
    const binding = resolveReviewSourceVersion(review, sourceVersions, outputVersions)
    const status = normalizedText(review.status) || 'UNKNOWN'
    const exportReady = Boolean(review.exportReady)
    return {
      id: review.id,
      status,
      statusLabel: reviewStatusLabel(status, exportReady),
      sourceBinding: binding.sourceBinding,
      sourceVersion: binding.sourceVersion,
      sourceVersionLabel: versionLabel(binding.sourceVersion),
      isForCurrentSource: Boolean(
        currentSourceVersion
        && binding.sourceVersion
        && currentSourceVersion.id === binding.sourceVersion.id
      ),
      exportReady,
      createdAt: normalizedText(review.createdAt) || null,
      completedAt: normalizedText(review.completedAt) || null,
    }
  })
}

function resolveReviewForVersion(
  reviews: ContractCenterResolvedReviewRun[],
  mode: 'current' | 'historical',
): ContractCenterResolvedReviewRun | null {
  return reviews.find((review) => (
    review.sourceBinding === 'matched_source_version'
    && (mode === 'current' ? review.isForCurrentSource : !review.isForCurrentSource)
  )) || null
}

type CurrentSourceReviewState = 'absent' | 'present'

function currentSourceReviewState(
  input: ContractCenterTaskModelInput,
  sourceVersions: ContractCenterVersionInput[],
  outputVersions: ContractCenterVersionInput[],
  currentSourceVersion: ContractCenterVersionInput | null
) : CurrentSourceReviewState {
  if (!currentSourceVersion) return 'absent'
  const candidates = input.latestReviewRun
    ? [input.latestReviewRun, ...(input.reviewRuns || [])]
    : (input.reviewRuns || [])

  for (const review of candidates) {
    const binding = resolveReviewSourceVersion(review, sourceVersions, outputVersions)
    if (binding.sourceVersion?.id === currentSourceVersion.id) return 'present'
  }
  // An unbound legacy review remains visible as a record that needs repair, but
  // it cannot prove that the verified current source has already been reviewed.
  // The fenced start RPC is the final duplicate-review guard.
  return 'absent'
}

function resolveSourceIdentity(
  input: ContractCenterTaskModelInput,
  currentSourceVersion: ContractCenterVersionInput | null,
  currentSourceResolution: ContractCenterCurrentSourceResolution,
  currentSourceReview: CurrentSourceReviewState
): ContractCenterSourceIdentityReadiness {
  if (currentSourceResolution.state === 'conflict') {
    return {
      state: 'stale',
      label: '当前文件版本需要核对',
      description: currentSourceResolution.description,
      ready: false,
      canStartReview: false,
    }
  }

  if (!currentSourceVersion) {
    return {
      state: 'not_applicable',
      label: '等待源文件',
      description: `先上传一份需要审核的 ${CONTRACT_SOURCE_FORMAT_LABEL} 原文件；DOC 和扫描 PDF 会先进入文件准备。`,
      ready: false,
      canStartReview: false,
    }
  }

  const identity = input.sourceIdentity
  if (!identity) {
    return {
      state: 'missing',
      label: '文件准备未完成',
      description: '当前文件还没有完成正文读取、身份校验和定位准备。',
      ready: false,
      canStartReview: false,
    }
  }

  const state = normalizedSource(identity.state)
  if (state === 'preparing') {
    return {
      state: 'preparing',
      label: '正在准备审核文件',
      description: '系统正在读取原文并建立风险定位，完成后才会发起审核。',
      ready: false,
      canStartReview: false,
    }
  }
  if (state === 'waiting_ocr') {
    return {
      state: 'waiting_ocr',
      label: '等待识别扫描内容',
      description: '原文件已保留；扫描内容识别或人工定位准备完成前不会生成假审核结果。',
      ready: false,
      canStartReview: false,
    }
  }
  if (state === 'waiting_conversion') {
    return {
      state: 'waiting_conversion',
      label: '原件已保留，等待可审核版本',
      description: '旧版 DOC 原件已完整保留；请转换为 DOCX 后补传，系统不会伪造正文定位或启动审核。',
      ready: false,
      canStartReview: false,
    }
  }
  if (state === 'failed') {
    return {
      state: 'failed',
      label: '文件准备需要重试',
      description: '原文件已保留，请打开合同查看失败步骤并重新准备审核文件。',
      ready: false,
      canStartReview: false,
    }
  }
  if (state === 'stale') {
    return {
      state: 'stale',
      label: '当前版本需要重新准备',
      description: '现有文件准备结果与当前版本不一致，需要重新读取和定位。',
      ready: false,
      canStartReview: false,
    }
  }
  if (state === 'missing') {
    return {
      state: 'missing',
      label: '文件准备未完成',
      description: '当前文件还没有完成正文读取、身份校验和定位准备。',
      ready: false,
      canStartReview: false,
    }
  }

  const claimsReady = identity.ready === true || state === 'ready'
  if (!claimsReady) {
    return {
      state: 'missing',
      label: '文件准备未完成',
      description: '当前文件还没有完成正文读取、身份校验和定位准备。',
      ready: false,
      canStartReview: false,
    }
  }

  const identityVersionId = normalizedText(identity.sourceVersionId)
  const identityPath = normalizedText(identity.storagePath)
  const versionMatches = Boolean(identityVersionId && identityVersionId === currentSourceVersion.id)
  const pathMatches = sameStoragePath(identity.storagePath, currentSourceVersion.storagePath)
  const hasIdentityReference = Boolean(identityVersionId || identityPath)
  const identityConflicts = !hasIdentityReference
    || Boolean(identityVersionId && !versionMatches)
    || Boolean(identityPath && !pathMatches)
  if (identityConflicts) {
    return {
      state: 'stale',
      label: '当前版本需要重新准备',
      description: '现有文件准备结果属于其他版本，系统需要为当前源文件重新读取和定位。',
      ready: false,
      canStartReview: false,
    }
  }

  return {
    state: 'ready',
    label: currentSourceReview === 'present'
      ? '当前版本已有审核记录'
      : '可以发起风险审核',
    description: currentSourceReview === 'present'
      ? '当前源文件已完成准备，并已关联到一次真实审核。'
      : '当前源文件的正文、身份和定位均已准备完成；无法归属的旧审核记录会单独保留待核对。',
    ready: true,
    canStartReview: currentSourceReview === 'absent',
  }
}

function availabilityLabel(availability: ContractCenterTaskAvailability) {
  if (availability === 'available') return '可开始'
  if (availability === 'needs_input') return '需补充文件'
  if (availability === 'in_progress') return '进行中'
  return '暂不可用'
}

function buildTask(
  task: Omit<ContractCenterBusinessTask, 'availabilityLabel'>
): ContractCenterBusinessTask {
  return {
    ...task,
    availabilityLabel: availabilityLabel(task.availability),
  }
}

function continueReviewTask(
  contractId: string | null,
  contractName: string,
  latestReview: ContractCenterResolvedReviewRun | null
) {
  if (!contractId) {
    return buildTask({
      id: 'continue_review',
      availability: 'blocked',
      label: '继续/查看已有审核',
      objectLabel: '一份已有审核记录的合同',
      preconditionLabel: '先选择一份已有风险审核记录的合同',
      href: null,
      nextAction: {
        id: 'select_reviewed_contract',
        label: '选择已有审核',
        description: '从合同列表选择一份已有审核记录的合同。',
      },
      blockedReason: '尚未选择合同，不能确定要继续哪一次审核。',
    })
  }

  if (!latestReview) {
    return buildTask({
      id: 'continue_review',
      availability: 'blocked',
      label: '继续/查看已有审核',
      objectLabel: contractName,
      preconditionLabel: '合同至少有一次真实审核记录',
      href: null,
      nextAction: {
        id: 'start_first_review',
        label: '先发起风险审核',
        description: '这份合同还没有可继续的审核记录。',
      },
      blockedReason: '当前合同还没有风险审核记录，不能把合同状态当作审核记录。',
    })
  }

  const href = `/contracts/${encodeURIComponent(contractId)}?from=list`
  const objectLabel = latestReview.sourceBinding === 'matched_source_version'
    ? `${contractName} · ${latestReview.sourceVersionLabel}`
    : `${contractName} · 审核文件版本待核对`
  const category = reviewStatusCategory(latestReview.status)

  if (latestReview.sourceBinding !== 'matched_source_version') {
    return buildTask({
      id: 'continue_review',
      availability: 'available',
      label: '继续/查看已有审核',
      objectLabel,
      preconditionLabel: '已有审核记录，但需要核对它引用的源文件版本',
      href,
      nextAction: {
        id: 'inspect_review_source',
        label: '查看审核记录并核对文件',
        description: '保留审核记录可见性，同时停止把无法确认来源的结果冒充当前版本审核。',
      },
      blockedReason: null,
    })
  }

  if (category === 'running') {
    return buildTask({
      id: 'continue_review',
      availability: 'in_progress',
      label: '继续/查看已有审核',
      objectLabel,
      preconditionLabel: '已有正在运行的审核记录',
      href,
      nextAction: {
        id: 'view_review_progress',
        label: '查看审核进度',
        description: latestReview.isForCurrentSource
          ? '查看当前文件的解析、规则判断和模型审核进度。'
          : '查看该文件版本的审核进度；当前版本与本次审核文件不同。',
      },
      blockedReason: null,
    })
  }

  if (category === 'failed') {
    return buildTask({
      id: 'continue_review',
      availability: 'available',
      label: '继续/查看已有审核',
      objectLabel,
      preconditionLabel: '已有未完成的审核记录',
      href,
      nextAction: {
        id: 'inspect_failed_review',
        label: '查看失败原因并重试',
        description: '先查看失败发生在哪一步，再从该步骤恢复，不重新制造合同或文件版本。',
      },
      blockedReason: null,
    })
  }

  if (category === 'degraded') {
    return buildTask({
      id: 'continue_review',
      availability: 'available',
      label: '继续/查看已有审核',
      objectLabel,
      preconditionLabel: '已有降级完成、需要人工复核的审核记录',
      href,
      nextAction: {
        id: 'review_degraded_result',
        label: '复核降级结果',
        description: '进入审核工作台核对未完成的规则证据、模型调用或原文定位，不将降级结果冒充已通过。',
      },
      blockedReason: null,
    })
  }

  if (category === 'completed') {
    return buildTask({
      id: 'continue_review',
      availability: 'available',
      label: '继续/查看已有审核',
      objectLabel,
      preconditionLabel: '已有已完成的审核记录',
      href,
      nextAction: latestReview.exportReady
        ? {
            id: 'download_annotated_document',
            label: '下载批注版',
            description: '查看已完成的风险处理，并下载基于原文件副本生成的批注版。',
          }
        : {
            id: 'handle_review_risks',
            label: '处理审核风险',
            description: '进入审核工作台定位风险、复核结论和准备后续批注输出。',
          },
      blockedReason: null,
    })
  }

  return buildTask({
    id: 'continue_review',
    availability: 'available',
    label: '继续/查看已有审核',
    objectLabel,
    preconditionLabel: '已有审核记录',
    href,
    nextAction: {
      id: 'inspect_review',
      label: '查看审核记录',
      description: '进入审核工作台确认当前业务状态和下一步。',
    },
    blockedReason: null,
  })
}

function resolveComparison(
  contractId: string | null,
  sourceVersions: ContractCenterVersionInput[]
): ContractCenterComparisonReadiness {
  if (!contractId) {
    return {
      state: 'no_contract',
      label: '先选择合同',
      description: '文档比对必须发生在一份明确合同的版本流中。',
      canStartComparison: false,
      sourceVersionCount: 0,
    }
  }
  if (sourceVersions.length === 0) {
    return {
      state: 'no_source_version',
      label: '先上传源文件',
      description: '当前合同还没有可比对的源版本；批注输出不能作为源版本。',
      canStartComparison: false,
      sourceVersionCount: 0,
    }
  }
  if (sourceVersions.length === 1) {
    return {
      state: 'needs_second_version',
      label: '上传一个新版本',
      description: '已有一个源版本；上传客户回传版或人工修订版后再选择旧版与新版。',
      canStartComparison: false,
      sourceVersionCount: 1,
    }
  }
  return {
    state: 'ready',
    label: '可以选择两个版本',
    description: '从同一合同的源版本中明确选择旧版和新版。',
    canStartComparison: true,
    sourceVersionCount: sourceVersions.length,
  }
}

function compareVersionsTask(
  contractId: string | null,
  contractName: string,
  comparison: ContractCenterComparisonReadiness
) {
  if (!contractId) {
    return buildTask({
      id: 'compare_versions',
      availability: 'blocked',
      label: '选择版本进行文档比对',
      objectLabel: '同一合同的旧版与新版',
      preconditionLabel: '先选择一份合同',
      href: null,
      nextAction: {
        id: 'select_contract_for_comparison',
        label: '选择合同',
        description: '先从合同列表选择需要比对的合同，不静默选择最近合同。',
      },
      blockedReason: '尚未选择合同；系统不会替你猜测要比对哪一份合同。',
    })
  }

  const href = `/contracts/${encodeURIComponent(contractId)}/compare?from=workbench`
  if (comparison.state === 'ready') {
    return buildTask({
      id: 'compare_versions',
      availability: 'available',
      label: '选择版本进行文档比对',
      objectLabel: `${contractName} · ${comparison.sourceVersionCount} 个源版本`,
      preconditionLabel: '明确选择两个不同源版本',
      href,
      nextAction: {
        id: 'select_versions',
        label: '选择旧版与新版',
        description: '进入比对准备页，明确选择基准版本和候选版本。',
      },
      blockedReason: null,
    })
  }

  return buildTask({
    id: 'compare_versions',
    availability: 'needs_input',
    label: '选择版本进行文档比对',
    objectLabel: contractName,
    preconditionLabel: '真正开始比对前需要两个不同源版本',
    href,
    nextAction: {
      id: comparison.state === 'needs_second_version' ? 'upload_next_version' : 'upload_first_version',
      label: comparison.state === 'needs_second_version' ? '上传新版本' : '上传源文件',
      description: comparison.description,
    },
    blockedReason: comparison.description,
  })
}

export function deriveContractCenterTaskModel(
  input: ContractCenterTaskModelInput
): ContractCenterTaskModel {
  const allVersions = (input.versions || []).filter((version) => Boolean(normalizedText(version.id)))
  const sourceVersions = sortVersionsNewestFirst(
    allVersions.filter((version) => versionKind(version) === 'source')
  )
  const outputVersions = sortVersionsNewestFirst(
    allVersions.filter((version) => versionKind(version) === 'output')
  )
  const currentSource = pickCurrentSourceVersion(sourceVersions, input)
  const currentSourceVersion = currentSource.version
  const contractId = normalizedText(input.contract?.id) || null
  const contractName = normalizedText(input.contract?.name) || '当前合同'
  const reviewRuns = resolveReviewRuns(
    input,
    sourceVersions,
    outputVersions,
    currentSourceVersion
  )
  const latestReview = reviewRuns[0] || null
  const currentReview = resolveReviewForVersion(
    reviewRuns,
    'current',
  )
  const latestHistoricalReview = resolveReviewForVersion(
    reviewRuns,
    'historical',
  )
  const currentSourceReview = currentSourceReviewState(
    input,
    sourceVersions,
    outputVersions,
    currentSourceVersion
  )
  const sourceIdentity = resolveSourceIdentity(
    input,
    currentSourceVersion,
    currentSource.resolution,
    currentSourceReview
  )
  const comparison = resolveComparison(contractId, sourceVersions)

  const tasks: Record<ContractCenterTaskId, ContractCenterBusinessTask> = {
    draft_contract: buildTask({
      id: 'draft_contract',
      availability: 'available',
      label: '起草合同',
      objectLabel: '一份新的合同草稿',
      preconditionLabel: '无',
      href: '/contracts/draft',
      nextAction: {
        id: 'start_draft',
        label: '开始起草',
        description: '进入起草页创建新草稿；当前不承诺恢复既有草稿。',
      },
      blockedReason: null,
    }),
    start_review: buildTask({
      id: 'start_review',
      availability: 'available',
      label: '上传并发起风险审核',
      objectLabel: `一份 ${CONTRACT_SOURCE_FORMAT_LABEL} 原文件`,
      preconditionLabel: '文件通过格式、大小和安全校验；DOC 需转换，扫描 PDF 需先识别正文',
      href: '/contracts/new?from=workbench',
      nextAction: {
        id: 'upload_review_source',
        label: '上传源文件',
        description: '保存文件并完成正文、身份和定位准备后，系统只创建一次初始审核。',
      },
      blockedReason: null,
    }),
    continue_review: continueReviewTask(contractId, contractName, latestReview),
    compare_versions: compareVersionsTask(contractId, contractName, comparison),
  }

  return {
    sourceVersions,
    outputVersions,
    currentSourceVersion,
    currentSourceVersionLabel: versionLabel(currentSourceVersion),
    currentSourceResolution: currentSource.resolution,
    sourceIdentity,
    reviewRuns,
    latestReview,
    currentReview,
    latestHistoricalReview,
    comparison,
    tasks,
    taskOrder: [...CONTRACT_CENTER_TASK_ORDER],
  }
}
