import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import {
  loadCurrentReviewSourceIdentity,
  resolveReviewRunSourceVersion,
  reviewRunMatchesSourceVersion,
  selectReviewRunForSourceVersion,
} from './review-source-identity'

function query(result: unknown) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  return chain
}

describe('loadCurrentReviewSourceIdentity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the page-map identity for the contract current storage path', async () => {
    const hash = 'a'.repeat(64)
    const textHash = 'b'.repeat(64)
    mocks.from.mockReturnValue(query({
      data: { storage_path: 'contracts/a.docx', source_hash: hash, source_text_hash: textHash },
      error: null,
    }))

    await expect(loadCurrentReviewSourceIdentity('contract-1', 'contracts/a.docx')).resolves.toEqual({
      source_storage_path: 'contracts/a.docx', source_hash: hash, source_text_hash: textHash,
    })
  })

  it('fails closed when the current source has no valid frozen page map', async () => {
    mocks.from.mockReturnValue(query({ data: null, error: null }))

    await expect(loadCurrentReviewSourceIdentity('contract-1', 'contracts/a.docx'))
      .rejects.toMatchObject({ code: 'SOURCE_IDENTITY_MISSING' })
  })
})

describe('ReviewRun source version binding', () => {
  const version1 = {
    id: 'version-1',
    storage_path: 'contracts/a/v1.docx',
    file_sha256: '1'.repeat(64),
    text_sha256: 'a'.repeat(64),
  }
  const version2 = {
    id: 'version-2',
    storage_path: 'contracts/a/v2.docx',
    file_sha256: '2'.repeat(64),
    text_sha256: 'b'.repeat(64),
  }
  const review1 = {
    id: 'review-1',
    contract_version_id: version1.id,
    source_storage_path: version1.storage_path,
    source_hash: version1.file_sha256,
    source_text_hash: version1.text_sha256,
  }

  it('does not treat an exact v1 ReviewRun as the review for current v2', () => {
    expect(reviewRunMatchesSourceVersion(review1, version1)).toBe(true)
    expect(reviewRunMatchesSourceVersion(review1, version2)).toBe(false)
    expect(selectReviewRunForSourceVersion([review1], version2)).toBeNull()
    expect(resolveReviewRunSourceVersion(review1, [version2, version1])).toEqual(version1)
  })

  it('fails closed when the version id agrees but path or hashes do not', () => {
    expect(reviewRunMatchesSourceVersion({
      ...review1,
      contract_version_id: version2.id,
    }, version2)).toBe(false)
    expect(reviewRunMatchesSourceVersion({
      ...review1,
      contract_version_id: version1.id,
      source_hash: 'f'.repeat(64),
    }, version1)).toBe(false)
  })

  it('accepts a migrated row without version id only through exact source identity', () => {
    const migratedReview = { ...review1, contract_version_id: null }
    expect(reviewRunMatchesSourceVersion(migratedReview, version1)).toBe(true)
    expect(reviewRunMatchesSourceVersion(migratedReview, version2)).toBe(false)
  })
})
