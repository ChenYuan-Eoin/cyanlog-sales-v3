export type ComparisonSourceVerificationReason =
  | 'baseline_snapshot_missing'
  | 'baseline_snapshot_not_creation_immutable'
  | 'baseline_storage_path_missing'
  | 'baseline_sha256_invalid'
  | 'baseline_captured_at_invalid'
  | 'compare_snapshot_missing'
  | 'compare_snapshot_not_creation_immutable'
  | 'compare_storage_path_missing'
  | 'compare_sha256_invalid'
  | 'compare_captured_at_invalid'

export type ComparisonSourceVerification = {
  status: 'verified' | 'unverified'
  can_start_review: boolean
  reasons: ComparisonSourceVerificationReason[]
}

export type ComparisonSourceSnapshot = {
  storage_path: string
  sha256: string
  captured_at: string
  immutable_at_creation: true
}

type SourceSnapshotSide = 'baseline' | 'compare'

const SHA256_HEX = /^[a-f0-9]{64}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isValidCapturedAt(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  return Number.isFinite(Date.parse(value))
}

function snapshotReasons(
  side: SourceSnapshotSide,
  snapshot: unknown
): ComparisonSourceVerificationReason[] {
  if (!isRecord(snapshot)) {
    return [`${side}_snapshot_missing`]
  }

  const reasons: ComparisonSourceVerificationReason[] = []
  if (snapshot.immutable_at_creation !== true) {
    reasons.push(`${side}_snapshot_not_creation_immutable`)
  }
  if (typeof snapshot.storage_path !== 'string' || !snapshot.storage_path.trim()) {
    reasons.push(`${side}_storage_path_missing`)
  }
  if (typeof snapshot.sha256 !== 'string' || !SHA256_HEX.test(snapshot.sha256)) {
    reasons.push(`${side}_sha256_invalid`)
  }
  if (!isValidCapturedAt(snapshot.captured_at)) {
    reasons.push(`${side}_captured_at_invalid`)
  }
  return reasons
}

/**
 * Determines whether a comparison is bound to immutable source-file identities.
 *
 * Only creation-time snapshots stored on the comparison record belong here. Live
 * contract/version IDs, current storage paths, filenames, or file URLs are not
 * identity evidence and must never be adapted into this input.
 */
export function evaluateComparisonSourceVerification({
  baseline_snapshot,
  compare_snapshot,
}: {
  baseline_snapshot?: unknown
  compare_snapshot?: unknown
}): ComparisonSourceVerification {
  const reasons = [
    ...snapshotReasons('baseline', baseline_snapshot),
    ...snapshotReasons('compare', compare_snapshot),
  ]

  if (reasons.length > 0) {
    return {
      status: 'unverified',
      can_start_review: false,
      reasons,
    }
  }

  return {
    status: 'verified',
    can_start_review: true,
    reasons: [],
  }
}
