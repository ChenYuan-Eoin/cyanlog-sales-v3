import { describe, expect, it, vi } from 'vitest'
import { resolveCurrentReviewArtifactBinding } from './current-review-binding'

const sourceVersion = {
  id: 'version-2',
  contract_id: 'contract-1',
  storage_path: 'contract-1/upload/source',
  file_sha256: 'a'.repeat(64),
  text_sha256: 'b'.repeat(64),
  ingest_status: 'SOURCE_READY',
}

const pageMap = {
  contract_version_id: 'version-2',
  storage_path: sourceVersion.storage_path,
  source_hash: sourceVersion.file_sha256,
  source_text_hash: sourceVersion.text_sha256,
}

const currentReview = {
  id: 'review-2',
  contract_id: 'contract-1',
  contract_version_id: 'version-2',
  status: 'COMPLETED',
  source_storage_path: sourceVersion.storage_path,
  source_hash: sourceVersion.file_sha256,
  source_text_hash: sourceVersion.text_sha256,
}

function query(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'order']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.limit = vi.fn().mockResolvedValue(result)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  return chain
}

function clientFor(input: {
  version?: unknown
  pageMap?: unknown
  review?: unknown
}) {
  const queries = {
    contract_versions: query({ data: input.version ?? sourceVersion, error: null }),
    contract_source_page_maps: query({ data: input.pageMap ?? pageMap, error: null }),
    contract_reviews: query({ data: [input.review ?? currentReview], error: null }),
  }
  return {
    queries,
    client: {
      from: vi.fn((table: keyof typeof queries) => queries[table]),
    },
  }
}

describe('resolveCurrentReviewArtifactBinding', () => {
  it('returns only a review whose immutable identity matches a ready current source and page map', async () => {
    const { client, queries } = clientFor({})

    await expect(resolveCurrentReviewArtifactBinding({
      contractId: 'contract-1',
      currentVersionId: 'version-2',
      client: client as never,
      mode: 'write',
    })).resolves.toEqual({
      contractId: 'contract-1',
      reviewId: 'review-2',
      contractVersionId: 'version-2',
      reviewStatus: 'COMPLETED',
    })
    expect(queries.contract_reviews.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false })
    expect(queries.contract_reviews.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false })
  })

  it('fails closed when the review hash identity does not match the current source', async () => {
    const { client } = clientFor({
      review: { ...currentReview, source_hash: 'c'.repeat(64) },
    })

    await expect(resolveCurrentReviewArtifactBinding({
      contractId: 'contract-1',
      currentVersionId: 'version-2',
      client: client as never,
    })).resolves.toBeNull()
  })

  it('fails closed when the page map is stale or the source was downgraded', async () => {
    const staleMapClient = clientFor({
      pageMap: { ...pageMap, source_text_hash: 'c'.repeat(64) },
    }).client
    await expect(resolveCurrentReviewArtifactBinding({
      contractId: 'contract-1',
      currentVersionId: 'version-2',
      client: staleMapClient as never,
    })).resolves.toBeNull()

    const failedVersionClient = clientFor({
      version: { ...sourceVersion, ingest_status: 'FAILED' },
    }).client
    await expect(resolveCurrentReviewArtifactBinding({
      contractId: 'contract-1',
      currentVersionId: 'version-2',
      client: failedVersionClient as never,
    })).resolves.toBeNull()
  })

  it('allows exact in-progress evidence to be read but not mutated', async () => {
    const { client } = clientFor({
      review: { ...currentReview, status: 'ANALYZING' },
    })

    await expect(resolveCurrentReviewArtifactBinding({
      contractId: 'contract-1',
      currentVersionId: 'version-2',
      client: client as never,
      mode: 'write',
    })).resolves.toBeNull()

    const readClient = clientFor({
      review: { ...currentReview, status: 'ANALYZING' },
    }).client
    await expect(resolveCurrentReviewArtifactBinding({
      contractId: 'contract-1',
      currentVersionId: 'version-2',
      client: readClient as never,
      mode: 'read',
    })).resolves.toMatchObject({ reviewId: 'review-2', reviewStatus: 'ANALYZING' })
  })
})
