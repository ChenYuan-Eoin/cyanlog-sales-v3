export type ComparisonSourceRole = 'old' | 'new'

export interface FrozenComparisonSource {
  role: ComparisonSourceRole
  org_id: string
  contract_id: string
  storage_path: string
  file_name: string
  file_sha256: string
  text_sha256: string
  mime_type: string
}

export interface ExpectedFrozenSourceIdentity {
  role: ComparisonSourceRole
  org_id?: string
  contract_id?: string
  storage_path?: string
  file_sha256?: string
  text_sha256?: string
  mime_type?: string
}

export type FrozenSourceVerification =
  | { ok: true; source: FrozenComparisonSource }
  | { ok: false; reasons: string[] }

const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-word.document.macroenabled.12': '.docm',
}

const SHA256 = /^[0-9a-f]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0
}

function isSafeStoragePath(path: string) {
  if (path.startsWith('/') || path.includes('\\') || path.includes('//')) return false
  const segments = path.split('/')
  if (segments.length < 2) return false
  return segments.every((segment) => {
    if (!segment || segment === '.' || segment === '..') return false
    try {
      const decoded = decodeURIComponent(segment)
      return decoded !== '.' && decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\')
    } catch {
      return false
    }
  })
}

function expectedMismatch(
  reasons: string[],
  actual: string,
  expected: string | undefined,
  code: string
) {
  if (expected !== undefined && actual !== expected) reasons.push(code)
}

/** Pure verification against the frozen row and request identity; never reads a current contract. */
export function verifyFrozenComparisonSource(
  input: unknown,
  expected: ExpectedFrozenSourceIdentity
): FrozenSourceVerification {
  if (!isRecord(input)) return { ok: false, reasons: ['INVALID_SOURCE'] }

  const reasons: string[] = []
  const role = input.role
  const orgId = input.org_id
  const contractId = input.contract_id
  const storagePath = input.storage_path
  const fileName = input.file_name
  const fileSha256 = input.file_sha256
  const textSha256 = input.text_sha256
  const mimeType = input.mime_type

  if (role !== 'old' && role !== 'new') reasons.push('INVALID_ROLE')
  if (!isNonEmptyString(orgId)) reasons.push('INVALID_ORG_ID')
  if (!isNonEmptyString(contractId)) reasons.push('INVALID_CONTRACT_ID')
  if (!isNonEmptyString(storagePath) || !isSafeStoragePath(storagePath)) reasons.push('INVALID_STORAGE_PATH')
  if (!isNonEmptyString(fileName)) reasons.push('INVALID_FILE_NAME')
  if (typeof fileSha256 !== 'string' || !SHA256.test(fileSha256)) reasons.push('INVALID_FILE_HASH')
  if (typeof textSha256 !== 'string' || !SHA256.test(textSha256)) reasons.push('INVALID_TEXT_HASH')

  const normalizedMime = typeof mimeType === 'string' ? mimeType.toLowerCase() : ''
  const expectedExtension = MIME_EXTENSIONS[normalizedMime]
  if (!expectedExtension) reasons.push('UNSUPPORTED_MIME_TYPE')
  if (
    expectedExtension
    && typeof fileName === 'string'
    && !fileName.toLowerCase().endsWith(expectedExtension)
  ) reasons.push('MIME_EXTENSION_MISMATCH')
  if (
    typeof storagePath === 'string'
    && typeof contractId === 'string'
    && !storagePath.startsWith(`${contractId}/`)
  ) reasons.push('STORAGE_CONTRACT_MISMATCH')

  if (role === 'old' || role === 'new') expectedMismatch(reasons, role, expected.role, 'ROLE_MISMATCH')
  if (typeof orgId === 'string') expectedMismatch(reasons, orgId, expected.org_id, 'ORG_MISMATCH')
  if (typeof contractId === 'string') expectedMismatch(reasons, contractId, expected.contract_id, 'CONTRACT_MISMATCH')
  if (typeof storagePath === 'string') expectedMismatch(reasons, storagePath, expected.storage_path, 'STORAGE_PATH_MISMATCH')
  if (typeof fileSha256 === 'string') expectedMismatch(reasons, fileSha256, expected.file_sha256, 'FILE_HASH_MISMATCH')
  if (typeof textSha256 === 'string') expectedMismatch(reasons, textSha256, expected.text_sha256, 'TEXT_HASH_MISMATCH')
  if (typeof mimeType === 'string' && expected.mime_type !== undefined) {
    if (normalizedMime !== expected.mime_type.toLowerCase()) reasons.push('MIME_TYPE_MISMATCH')
  }

  if (reasons.length > 0) return { ok: false, reasons: [...new Set(reasons)] }
  return { ok: true, source: input as unknown as FrozenComparisonSource }
}

export function verifyFrozenComparisonPair(
  sources: readonly unknown[],
  orgId: string
): { ok: true; old: FrozenComparisonSource; new: FrozenComparisonSource } | { ok: false; reasons: string[] } {
  const oldCandidates = sources.filter((source) => isRecord(source) && source.role === 'old')
  const newCandidates = sources.filter((source) => isRecord(source) && source.role === 'new')
  if (oldCandidates.length !== 1 || newCandidates.length !== 1) {
    return { ok: false, reasons: ['PAIR_MUST_HAVE_ONE_OLD_AND_ONE_NEW'] }
  }

  const oldResult = verifyFrozenComparisonSource(oldCandidates[0], { role: 'old', org_id: orgId })
  const newResult = verifyFrozenComparisonSource(newCandidates[0], { role: 'new', org_id: orgId })
  if (!oldResult.ok || !newResult.ok) {
    return {
      ok: false,
      reasons: [
        ...(oldResult.ok ? [] : oldResult.reasons.map((reason) => `OLD_${reason}`)),
        ...(newResult.ok ? [] : newResult.reasons.map((reason) => `NEW_${reason}`)),
      ],
    }
  }
  return { ok: true, old: oldResult.source, new: newResult.source }
}
