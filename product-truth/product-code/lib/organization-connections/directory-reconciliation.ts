type PrimaryDepartmentDecision =
  | { kind: 'unchanged' | 'apply_upstream' | 'preserve_local'; effective: string | null }
  | { kind: 'review'; effective: string | null; reason: 'missing_baseline' | 'diverged' }

type DepartmentReconciliationInput = {
  previousPrimary: string | null
  currentPrimary: string | null
  incomingPrimary: string
  currentProviderDepartmentIds: readonly string[]
  incomingDepartmentIds: readonly string[]
  retainedPrimary?: { current: string | null; incoming: string } | null
  adoptedPrimary?: { current: string | null; incoming: string } | null
}

function reconcilePrimary({ previousPrimary, currentPrimary, incomingPrimary, retainedPrimary, adoptedPrimary }: DepartmentReconciliationInput): PrimaryDepartmentDecision {
  if (currentPrimary === incomingPrimary) {
    return { kind: 'unchanged', effective: currentPrimary }
  }
  if (retainedPrimary?.current === currentPrimary && retainedPrimary.incoming === incomingPrimary) {
    return { kind: 'preserve_local', effective: currentPrimary }
  }
  if (adoptedPrimary?.current === currentPrimary && adoptedPrimary.incoming === incomingPrimary) {
    return { kind: 'apply_upstream', effective: incomingPrimary }
  }
  if (previousPrimary === null) {
    return { kind: 'review', effective: currentPrimary, reason: 'missing_baseline' }
  }
  if (currentPrimary === previousPrimary) {
    return { kind: 'apply_upstream', effective: incomingPrimary }
  }
  if (incomingPrimary === previousPrimary) {
    return { kind: 'preserve_local', effective: currentPrimary }
  }
  return { kind: 'review', effective: currentPrimary, reason: 'diverged' }
}

// The caller proves the provider's readable scope before applying any result.
// Department IDs are provider IDs, except that an ICU-owned primary may use a
// distinct local key. Links owned by ICU or another provider are outside this diff.
export function reconcileDirectoryDepartments(input: DepartmentReconciliationInput) {
  const { previousPrimary, currentPrimary, incomingPrimary, currentProviderDepartmentIds, incomingDepartmentIds } = input
  const primary = reconcilePrimary(input)
  const effectiveProviderDepartmentIds = new Set(currentProviderDepartmentIds)

  if (primary.kind !== 'review') {
    for (const id of incomingDepartmentIds) {
      // A local-only move does not turn the former upstream primary into a secondary.
      if (primary.kind !== 'preserve_local' || id !== incomingPrimary) effectiveProviderDepartmentIds.add(id)
    }
  }
  if (primary.kind === 'apply_upstream' && currentPrimary !== null && !incomingDepartmentIds.includes(currentPrimary)) {
    // An explicit new primary replaces the former primary. Missing secondary
    // links are preserved until the provider explicitly confirms their removal.
    effectiveProviderDepartmentIds.delete(currentPrimary)
  }

  return {
    primary,
    effectiveProviderDepartmentIds: [...effectiveProviderDepartmentIds].sort(),
    nextPrimaryBaseline: primary.kind === 'apply_upstream' || primary.kind === 'unchanged' ? incomingPrimary : previousPrimary,
  }
}
