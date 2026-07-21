import { supabaseAdmin } from '@/lib/supabase'

const SHA256 = /^[0-9a-f]{64}$/

export type ReviewRunSourceReference = {
  id: string
  contract_version_id?: string | null
  source_storage_path?: string | null
  source_hash?: string | null
  source_text_hash?: string | null
}

export type ReviewSourceVersionReference = {
  id: string
  storage_path?: string | null
  file_sha256?: string | null
  text_sha256?: string | null
}

export type ReviewSourceIdentity = {
  source_storage_path: string
  source_hash: string
  source_text_hash: string
}

export class ReviewSourceIdentityError extends Error {
  readonly code: 'SOURCE_IDENTITY_MISSING' | 'SOURCE_IDENTITY_LOOKUP_FAILED'

  constructor(
    code: 'SOURCE_IDENTITY_MISSING' | 'SOURCE_IDENTITY_LOOKUP_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'ReviewSourceIdentityError'
    this.code = code
  }
}

function exactSourceIdentityMatches(
  review: ReviewRunSourceReference,
  version: ReviewSourceVersionReference,
) {
  return Boolean(
    review.source_storage_path
      && version.storage_path
      && review.source_storage_path === version.storage_path
      && SHA256.test(review.source_hash || '')
      && SHA256.test(version.file_sha256 || '')
      && review.source_hash === version.file_sha256
      && SHA256.test(review.source_text_hash || '')
      && SHA256.test(version.text_sha256 || '')
      && review.source_text_hash === version.text_sha256
  )
}

/**
 * A ReviewRun belongs to a source version only when its immutable database
 * identity agrees with that version. New runs must carry contract_version_id;
 * exact path + file hash + text hash remains a compatibility path for migrated
 * historical rows whose version id could not be backfilled.
 */
export function reviewRunMatchesSourceVersion(
  review: ReviewRunSourceReference,
  version: ReviewSourceVersionReference | null | undefined,
) {
  if (!version) return false
  if (review.contract_version_id && review.contract_version_id !== version.id) return false
  return exactSourceIdentityMatches(review, version)
}

export function resolveReviewRunSourceVersion<TVersion extends ReviewSourceVersionReference>(
  review: ReviewRunSourceReference,
  versions: TVersion[],
): TVersion | null {
  if (review.contract_version_id) {
    const referencedVersion = versions.find((version) => version.id === review.contract_version_id)
    return reviewRunMatchesSourceVersion(review, referencedVersion) ? referencedVersion || null : null
  }
  return versions.find((version) => reviewRunMatchesSourceVersion(review, version)) || null
}

export function selectReviewRunForSourceVersion<TReview extends ReviewRunSourceReference>(
  reviews: TReview[],
  version: ReviewSourceVersionReference | null | undefined,
): TReview | null {
  if (!version) return null
  return reviews.find((review) => reviewRunMatchesSourceVersion(review, version)) || null
}

export async function loadCurrentReviewSourceIdentity(
  contractId: string,
  storagePath: string | null | undefined,
): Promise<ReviewSourceIdentity> {
  if (!storagePath) {
    throw new ReviewSourceIdentityError('SOURCE_IDENTITY_MISSING', '合同尚未绑定源文件')
  }

  const { data, error } = await supabaseAdmin
    .from('contract_source_page_maps')
    .select('storage_path, source_hash, source_text_hash')
    .eq('contract_id', contractId)
    .eq('storage_path', storagePath)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new ReviewSourceIdentityError('SOURCE_IDENTITY_LOOKUP_FAILED', '读取合同源文件身份失败')
  }
  if (
    data?.storage_path !== storagePath
    || !SHA256.test(data?.source_hash || '')
    || !SHA256.test(data?.source_text_hash || '')
  ) {
    throw new ReviewSourceIdentityError(
      'SOURCE_IDENTITY_MISSING',
      '合同当前源文件尚未完成可审计解析，不能创建 ReviewRun',
    )
  }

  return {
    source_storage_path: data.storage_path,
    source_hash: data.source_hash,
    source_text_hash: data.source_text_hash,
  }
}
