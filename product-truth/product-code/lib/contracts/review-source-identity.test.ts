import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import {
  loadCurrentReviewSourceIdentity,
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
