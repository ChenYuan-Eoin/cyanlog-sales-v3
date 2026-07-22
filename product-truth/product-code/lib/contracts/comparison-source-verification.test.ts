import { describe, expect, it } from 'vitest'
import {
  verifyFrozenComparisonPair,
  verifyFrozenComparisonSource,
  type FrozenComparisonSource,
} from './comparison-source-verification'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function source(role: 'old' | 'new', overrides: Partial<FrozenComparisonSource> = {}): FrozenComparisonSource {
  const contractId = role === 'old' ? 'contract-old' : 'contract-new'
  return {
    role,
    org_id: 'org-1',
    contract_id: contractId,
    storage_path: `${contractId}/upload_source.docx`,
    file_name: `${role}.docx`,
    file_sha256: role === 'old' ? HASH_A : HASH_B,
    text_sha256: role === 'old' ? HASH_B : HASH_A,
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ...overrides,
  }
}

describe('frozen comparison source verification', () => {
  it('accepts a complete frozen identity without consulting a current contract', () => {
    const frozen = source('old')
    expect(verifyFrozenComparisonSource(frozen, {
      role: 'old',
      org_id: 'org-1',
      storage_path: frozen.storage_path,
      file_sha256: frozen.file_sha256,
      text_sha256: frozen.text_sha256,
      mime_type: frozen.mime_type,
    })).toEqual({ ok: true, source: frozen })
  })

  it('fails closed on stale role, path or hash requests', () => {
    const result = verifyFrozenComparisonSource(source('old'), {
      role: 'new',
      storage_path: 'contract-old/another.docx',
      file_sha256: HASH_B,
      text_sha256: HASH_A,
    })

    expect(result).toEqual({
      ok: false,
      reasons: ['ROLE_MISMATCH', 'STORAGE_PATH_MISMATCH', 'FILE_HASH_MISMATCH', 'TEXT_HASH_MISMATCH'],
    })
  })

  it('rejects unsafe paths and a path outside the frozen contract namespace', () => {
    const traversal = verifyFrozenComparisonSource(source('old', {
      storage_path: 'contract-old/%2e%2e/secret.docx',
    }), { role: 'old' })
    const wrongContract = verifyFrozenComparisonSource(source('old', {
      storage_path: 'contract-new/upload_source.docx',
    }), { role: 'old' })

    expect(traversal).toEqual({ ok: false, reasons: ['INVALID_STORAGE_PATH'] })
    expect(wrongContract).toEqual({ ok: false, reasons: ['STORAGE_CONTRACT_MISMATCH'] })
  })

  it('rejects unsupported or extension-mismatched MIME facts', () => {
    expect(verifyFrozenComparisonSource(source('old', {
      mime_type: 'application/msword',
    }), { role: 'old' })).toEqual({ ok: false, reasons: ['UNSUPPORTED_MIME_TYPE'] })

    expect(verifyFrozenComparisonSource(source('old', {
      mime_type: 'application/pdf',
    }), { role: 'old' })).toEqual({ ok: false, reasons: ['MIME_EXTENSION_MISMATCH'] })
  })

  it('requires exactly one valid old and one valid new source in the same organization', () => {
    const valid = verifyFrozenComparisonPair([source('new'), source('old')], 'org-1')
    expect(valid.ok).toBe(true)

    expect(verifyFrozenComparisonPair([source('old'), source('old')], 'org-1')).toEqual({
      ok: false,
      reasons: ['PAIR_MUST_HAVE_ONE_OLD_AND_ONE_NEW'],
    })

    expect(verifyFrozenComparisonPair([
      source('old'),
      source('new', { org_id: 'org-2' }),
    ], 'org-1')).toEqual({ ok: false, reasons: ['NEW_ORG_MISMATCH'] })
  })
})
