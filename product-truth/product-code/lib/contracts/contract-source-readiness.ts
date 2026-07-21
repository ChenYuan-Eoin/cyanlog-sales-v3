const SHA256 = /^[0-9a-f]{64}$/i

const OUTPUT_VERSION_SOURCES = new Set([
  'review_revision',
  'output',
  'annotated',
  'annotated_document',
  'generated_output',
])

export const CONTRACT_SOURCE_FORMAT_LABEL = 'Word（DOC、DOCX、DOCM）或 PDF'

export type ContractSourceReadinessState =
  | 'ready'
  | 'preparing'
  | 'waiting_ocr'
  | 'waiting_conversion'
  | 'failed'
  | 'missing'
  | 'stale'

export type ContractSourceVersionReference = {
  id: string
  source?: string | null
  storage_path?: string | null
  ingest_status?: string | null
  ingest_error?: string | null
  file_sha256?: string | null
  text_sha256?: string | null
}

export type ContractSourcePageMapReference = {
  contract_version_id?: string | null
  storage_path?: string | null
  source_hash?: string | null
  source_text_hash?: string | null
  render_mode?: string | null
  locator?: string | null
  page_count?: number | null
  generated_at?: string | null
}

export type ContractSourceRecoveryAction = {
  id: 'upload_source' | 'replace_source' | 'supply_searchable_pdf' | 'supply_docx'
  label: string
  description: string
  href: string
}

export type ContractSourceReadinessProjection = {
  state: ContractSourceReadinessState
  label: string
  description: string
  ready: boolean
  can_start_review: boolean
  source_version_id: string | null
  storage_path: string | null
  file_sha256: string | null
  text_sha256: string | null
  page_map: {
    contract_version_id: string | null
    storage_path: string | null
    source_hash: string | null
    source_text_hash: string | null
    render_mode: string | null
    locator: string | null
    page_count: number | null
    generated_at: string | null
  } | null
  failure_reason: string | null
  recovery_action: ContractSourceRecoveryAction | null
}

type DeriveContractSourceReadinessInput = {
  contractId: string
  contractStoragePath?: string | null
  currentVersionId?: string | null
  versions: ContractSourceVersionReference[]
  pageMaps: ContractSourcePageMapReference[]
}

function normalized(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

function businessFailureReason(value: string | null | undefined) {
  const reason = normalized(value)
  if (reason === 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE') {
    return '这份历史文件缺少完整的文件身份、正文或风险定位记录，请重新上传原文件后再发起审核。'
  }
  return reason || '文件准备失败。'
}

function isSourceVersion(version: ContractSourceVersionReference) {
  return !OUTPUT_VERSION_SOURCES.has(normalized(version.source).toLowerCase())
}

function sourceReplacementHref(contractId: string) {
  return `/contracts/${encodeURIComponent(contractId)}/edit?intent=source-replacement`
}

function recoveryAction(
  contractId: string,
  id: ContractSourceRecoveryAction['id'],
  label: string,
  description: string,
): ContractSourceRecoveryAction {
  return {
    id,
    label,
    description,
    href: sourceReplacementHref(contractId),
  }
}

function pageMapSummary(pageMap: ContractSourcePageMapReference | null) {
  if (!pageMap) return null
  return {
    contract_version_id: pageMap.contract_version_id || null,
    storage_path: pageMap.storage_path || null,
    source_hash: pageMap.source_hash || null,
    source_text_hash: pageMap.source_text_hash || null,
    render_mode: pageMap.render_mode || null,
    locator: pageMap.locator || null,
    page_count: typeof pageMap.page_count === 'number' ? pageMap.page_count : null,
    generated_at: pageMap.generated_at || null,
  }
}

/**
 * Canonical business projection for whether a contract's current source file
 * may enter review. List and detail APIs must use this function so the same
 * version, hash and page-map facts cannot produce contradictory UI actions.
 */
export function deriveContractSourceReadiness({
  contractId,
  contractStoragePath,
  currentVersionId,
  versions,
  pageMaps,
}: DeriveContractSourceReadinessInput): ContractSourceReadinessProjection {
  const normalizedVersionId = normalized(currentVersionId)
  if (!normalizedVersionId) {
    const description = `请先上传 ${CONTRACT_SOURCE_FORMAT_LABEL} 原文件。DOC 和扫描 PDF 会先保留原件，再进入转换或文字识别。`
    return {
      state: 'missing',
      label: '等待审核源文件',
      description,
      ready: false,
      can_start_review: false,
      source_version_id: null,
      storage_path: normalized(contractStoragePath) || null,
      file_sha256: null,
      text_sha256: null,
      page_map: null,
      failure_reason: '当前合同尚未绑定审核源文件版本。',
      recovery_action: recoveryAction(
        contractId,
        'upload_source',
        '补充审核源文件',
        description,
      ),
    }
  }

  const currentVersion = versions.find(
    (version) => version.id === normalizedVersionId && isSourceVersion(version),
  ) || null
  if (!currentVersion) {
    const description = '当前合同指向的文件版本与现有源文件不一致。请重新选择或上传正确的审核源文件。'
    return {
      state: 'stale',
      label: '当前文件版本需要核对',
      description,
      ready: false,
      can_start_review: false,
      source_version_id: normalizedVersionId,
      storage_path: normalized(contractStoragePath) || null,
      file_sha256: null,
      text_sha256: null,
      page_map: null,
      failure_reason: '当前文件指针没有对应的源文件版本。',
      recovery_action: recoveryAction(
        contractId,
        'replace_source',
        '重新选择审核源文件',
        description,
      ),
    }
  }

  const currentStoragePath = normalized(currentVersion.storage_path)
  const exactPageMap = pageMaps.find((pageMap) => (
    pageMap.contract_version_id === currentVersion.id
      && normalized(pageMap.storage_path) === currentStoragePath
  )) || null
  const base = {
    source_version_id: currentVersion.id,
    storage_path: currentStoragePath || null,
    file_sha256: normalized(currentVersion.file_sha256) || null,
    text_sha256: normalized(currentVersion.text_sha256) || null,
    page_map: pageMapSummary(exactPageMap),
  }
  const ingestStatus = normalized(currentVersion.ingest_status).toUpperCase()

  if (ingestStatus === 'AWAITING_OCR') {
    const description = '原始扫描 PDF 已完整保留，但还没有可靠正文和风险定位。请补传 OCR 后的可检索 PDF。'
    return {
      ...base,
      state: 'waiting_ocr',
      label: '原件已保存，待正文识别',
      description,
      ready: false,
      can_start_review: false,
      failure_reason: '完成文字识别或补传可检索 PDF 后才能发起审核。',
      recovery_action: recoveryAction(
        contractId,
        'supply_searchable_pdf',
        '补传可检索 PDF',
        description,
      ),
    }
  }

  if (ingestStatus === 'AWAITING_CONVERSION') {
    const description = '旧版 DOC 原件已完整保留。请用 Word 或 LibreOffice 转为 DOCX 后补传可审核版本。'
    return {
      ...base,
      state: 'waiting_conversion',
      label: '原件已保存，待转换',
      description,
      ready: false,
      can_start_review: false,
      failure_reason: '旧版 DOC 需要转换为 DOCX 后才能建立可靠正文定位。',
      recovery_action: recoveryAction(
        contractId,
        'supply_docx',
        '补传 DOCX',
        description,
      ),
    }
  }

  if (ingestStatus === 'FAILED') {
    const description = '原文件已保留，但正文读取或风险定位没有完成。请重新上传审核文件以恢复准备。'
    return {
      ...base,
      state: 'failed',
      label: '文件准备失败',
      description,
      ready: false,
      can_start_review: false,
      failure_reason: businessFailureReason(currentVersion.ingest_error),
      recovery_action: recoveryAction(
        contractId,
        'replace_source',
        '重新上传审核文件',
        description,
      ),
    }
  }

  if (ingestStatus !== 'SOURCE_READY') {
    return {
      ...base,
      state: 'preparing',
      label: '正在准备审核文件',
      description: '系统正在读取原文并建立风险定位。全部完成前不会发起审核，请稍后刷新查看进度。',
      ready: false,
      can_start_review: false,
      failure_reason: null,
      recovery_action: null,
    }
  }

  if (!exactPageMap) {
    const description = '原文件已保留，但正文或风险定位尚未准备完整。请重新上传当前审核文件以恢复准备。'
    return {
      ...base,
      state: 'missing',
      label: '风险定位尚未准备完成',
      description,
      ready: false,
      can_start_review: false,
      failure_reason: '当前源文件还没有可验证的风险定位映射。',
      recovery_action: recoveryAction(
        contractId,
        'replace_source',
        '重新准备审核文件',
        description,
      ),
    }
  }

  const fileHash = normalized(currentVersion.file_sha256)
  const textHash = normalized(currentVersion.text_sha256)
  const identityMatches = Boolean(
    currentStoragePath
      && normalized(contractStoragePath) === currentStoragePath
      && SHA256.test(fileHash)
      && SHA256.test(textHash)
      && normalized(exactPageMap.source_hash) === fileHash
      && normalized(exactPageMap.source_text_hash) === textHash,
  )
  if (!identityMatches) {
    const description = '当前文件、文件版本与风险定位结果不一致。请重新上传当前审核文件，完成后再发起审核。'
    return {
      ...base,
      state: 'stale',
      label: '文件准备结果已失效',
      description,
      ready: false,
      can_start_review: false,
      failure_reason: '当前文件、源版本与风险定位映射的身份不一致。',
      recovery_action: recoveryAction(
        contractId,
        'replace_source',
        '重新准备当前版本',
        description,
      ),
    }
  }

  return {
    ...base,
    state: 'ready',
    label: '审核文件已准备完成',
    description: '当前文件的正文、文件身份和风险定位均已准备完成，可以发起或重新发起审核。',
    ready: true,
    can_start_review: true,
    failure_reason: null,
    recovery_action: null,
  }
}
