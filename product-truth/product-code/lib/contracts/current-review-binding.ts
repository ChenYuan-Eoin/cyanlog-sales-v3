import { supabaseAdmin } from '@/lib/supabase'
import { reviewRunMatchesSourceVersion } from './review-source-identity'

type ReviewBindingClient = typeof supabaseAdmin

type ReviewBindingRow = {
  id: string
  contract_id: string | null
  contract_version_id: string | null
  status?: string | null
  created_at?: string | null
  source_storage_path?: string | null
  source_hash?: string | null
  source_text_hash?: string | null
}

type CurrentVersionRow = {
  id: string
  contract_id: string | null
  storage_path: string | null
  file_sha256: string | null
  text_sha256: string | null
  ingest_status: string | null
}

type CurrentPageMapRow = {
  contract_version_id: string | null
  storage_path: string | null
  source_hash: string | null
  source_text_hash: string | null
}

export type CurrentReviewArtifactBinding = {
  contractId: string
  reviewId: string
  contractVersionId: string
  reviewStatus: string | null
}

export async function resolveCurrentReviewArtifactBinding(input: {
  contractId: string
  currentVersionId?: string | null
  client?: ReviewBindingClient
  mode?: 'read' | 'write'
}): Promise<CurrentReviewArtifactBinding | null> {
  const client = input.client || supabaseAdmin
  let currentVersionId = input.currentVersionId || null

  if (!currentVersionId) {
    const contractResult = await client
      .from('contracts')
      .select('current_version_id')
      .eq('id', input.contractId)
      .maybeSingle()

    if (contractResult.error) throw contractResult.error
    currentVersionId = contractResult.data?.current_version_id || null
  }

  if (!currentVersionId) return null

  const versionResult = await client
    .from('contract_versions')
    .select('id, contract_id, storage_path, file_sha256, text_sha256, ingest_status')
    .eq('id', currentVersionId)
    .eq('contract_id', input.contractId)
    .maybeSingle()
  if (versionResult.error) throw versionResult.error
  const version = versionResult.data as CurrentVersionRow | null
  if (
    !version
    || version.contract_id !== input.contractId
    || version.ingest_status !== 'SOURCE_READY'
  ) return null

  const pageMapResult = await client
    .from('contract_source_page_maps')
    .select('contract_version_id, storage_path, source_hash, source_text_hash')
    .eq('contract_id', input.contractId)
    .eq('contract_version_id', currentVersionId)
    .maybeSingle()
  if (pageMapResult.error) throw pageMapResult.error
  const pageMap = pageMapResult.data as CurrentPageMapRow | null
  if (
    !pageMap
    || pageMap.contract_version_id !== version.id
    || pageMap.storage_path !== version.storage_path
    || pageMap.source_hash !== version.file_sha256
    || pageMap.source_text_hash !== version.text_sha256
  ) return null

  const reviewResult = await client
    .from('contract_reviews')
    .select('id, contract_id, contract_version_id, status, created_at, source_storage_path, source_hash, source_text_hash')
    .eq('contract_id', input.contractId)
    .eq('contract_version_id', currentVersionId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)

  if (reviewResult.error) throw reviewResult.error
  const row = ((reviewResult.data || []) as ReviewBindingRow[])[0] || null
  if (
    !row?.id
    || row.contract_id !== input.contractId
    || row.contract_version_id !== currentVersionId
    || !reviewRunMatchesSourceVersion(row, version)
  ) {
    return null
  }

  const reviewStatus = row.status?.toUpperCase() || null
  if (input.mode === 'write' && reviewStatus !== 'COMPLETED' && reviewStatus !== 'DEGRADED') {
    return null
  }

  return {
    contractId: input.contractId,
    reviewId: row.id,
    contractVersionId: currentVersionId,
    reviewStatus,
  }
}
