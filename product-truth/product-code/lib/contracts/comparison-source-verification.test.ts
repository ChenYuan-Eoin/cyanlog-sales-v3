import { describe, expect, it } from 'vitest'
import { evaluateComparisonSourceVerification } from './comparison-source-verification'

const SHA256_A = 'a'.repeat(64)
const SHA256_B = 'b'.repeat(64)

function immutableSnapshot(storagePath: string, sha256: string) {
  return {
    storage_path: storagePath,
    sha256,
    captured_at: '2026-07-15T10:00:00.000Z',
    immutable_at_creation: true as const,
  }
}

describe('comparison source verification', () => {
  it('blocks review when the comparison has no creation-time source snapshots', () => {
    expect(evaluateComparisonSourceVerification({})).toEqual({
      status: 'unverified',
      can_start_review: false,
      reasons: [
        'baseline_snapshot_missing',
        'compare_snapshot_missing',
      ],
    })
  })

  it('does not treat document IDs or live storage paths as hash evidence', () => {
    const liveReference = {
      id: '11111111-1111-4111-8111-111111111111',
      source: 'version',
      storage_path: 'contracts/current.docx',
    }

    const result = evaluateComparisonSourceVerification({
      baseline_snapshot: liveReference,
      compare_snapshot: liveReference,
    })

    expect(result.status).toBe('unverified')
    expect(result.can_start_review).toBe(false)
    expect(result.reasons).toEqual(expect.arrayContaining([
      'baseline_snapshot_not_creation_immutable',
      'baseline_sha256_invalid',
      'compare_snapshot_not_creation_immutable',
      'compare_sha256_invalid',
    ]))
  })

  it('keeps snapshots unverified when their hash, path, provenance, or capture time is incomplete', () => {
    const result = evaluateComparisonSourceVerification({
      baseline_snapshot: {
        storage_path: 'contracts/baseline.docx',
        sha256: 'not-a-sha256',
        captured_at: 'not-a-date',
        immutable_at_creation: false,
      },
      compare_snapshot: immutableSnapshot('', SHA256_B),
    })

    expect(result).toEqual({
      status: 'unverified',
      can_start_review: false,
      reasons: [
        'baseline_snapshot_not_creation_immutable',
        'baseline_sha256_invalid',
        'baseline_captured_at_invalid',
        'compare_storage_path_missing',
      ],
    })
  })

  it('allows review only when both creation-time snapshots contain path and SHA-256 evidence', () => {
    expect(evaluateComparisonSourceVerification({
      baseline_snapshot: immutableSnapshot('contracts/baseline.docx', SHA256_A),
      compare_snapshot: immutableSnapshot('contracts/compare.docx', SHA256_B),
    })).toEqual({
      status: 'verified',
      can_start_review: true,
      reasons: [],
    })
  })
})
