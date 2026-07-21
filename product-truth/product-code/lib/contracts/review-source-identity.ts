import { supabaseAdmin } from '@/lib/supabase'

const SHA256 = /^[0-9a-f]{64}$/

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
