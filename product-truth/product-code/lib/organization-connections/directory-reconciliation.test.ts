import { describe, expect, it } from 'vitest'
import { reconcileDirectoryDepartments } from './directory-reconciliation'

const base = {
  previousPrimary: 'dept-a',
  currentPrimary: 'dept-a',
  incomingPrimary: 'dept-b',
  currentProviderDepartmentIds: ['dept-a', 'dept-d'],
  incomingDepartmentIds: ['dept-b'],
}

describe('reconcileDirectoryDepartments', () => {
  it('applies an explicit upstream primary move and preserves an unconfirmed secondary link', () => {
    expect(reconcileDirectoryDepartments(base)).toEqual({
      primary: { kind: 'apply_upstream', effective: 'dept-b' },
      effectiveProviderDepartmentIds: ['dept-b', 'dept-d'],
      nextPrimaryBaseline: 'dept-b',
    })
    expect(reconcileDirectoryDepartments({ ...base, incomingDepartmentIds: ['dept-b', 'dept-a', 'dept-d', 'dept-d'] })
      .effectiveProviderDepartmentIds).toEqual(['dept-a', 'dept-b', 'dept-d'])
  })

  it('recognizes convergence without another primary move', () => {
    expect(reconcileDirectoryDepartments({ ...base, currentPrimary: 'dept-b', currentProviderDepartmentIds: ['dept-b', 'dept-d'] })).toEqual({
      primary: { kind: 'unchanged', effective: 'dept-b' },
      effectiveProviderDepartmentIds: ['dept-b', 'dept-d'],
      nextPrimaryBaseline: 'dept-b',
    })
  })

  it('preserves a local-only primary move and does not restore the obsolete upstream primary as a secondary', () => {
    expect(reconcileDirectoryDepartments({
      ...base,
      currentPrimary: 'icu:manual-dept',
      currentProviderDepartmentIds: ['dept-d'],
      incomingPrimary: 'dept-a',
      incomingDepartmentIds: ['dept-a', 'dept-e'],
    })).toEqual({
      primary: { kind: 'preserve_local', effective: 'icu:manual-dept' },
      effectiveProviderDepartmentIds: ['dept-d', 'dept-e'],
      nextPrimaryBaseline: 'dept-a',
    })
  })

  it('freezes diverging changes and unknown historical baselines', () => {
    const divergent = { ...base, currentPrimary: 'dept-b', currentProviderDepartmentIds: ['dept-b', 'dept-d'], incomingPrimary: 'dept-c', incomingDepartmentIds: ['dept-c'] }
    expect(reconcileDirectoryDepartments(divergent)).toEqual({
      primary: { kind: 'review', effective: 'dept-b', reason: 'diverged' },
      effectiveProviderDepartmentIds: ['dept-b', 'dept-d'],
      nextPrimaryBaseline: 'dept-a',
    })
    expect(reconcileDirectoryDepartments({ ...divergent, previousPrimary: null }).primary)
      .toEqual({ kind: 'review', effective: 'dept-b', reason: 'missing_baseline' })
  })

  it('honors an exact retained choice and reviews a subsequent change', () => {
    const retained = {
      ...base,
      currentPrimary: 'dept-b',
      currentProviderDepartmentIds: ['dept-b', 'dept-d'],
      incomingPrimary: 'dept-c',
      incomingDepartmentIds: ['dept-c'],
      retainedPrimary: { current: 'dept-b', incoming: 'dept-c' },
    }
    expect(reconcileDirectoryDepartments(retained)).toEqual({
      primary: { kind: 'preserve_local', effective: 'dept-b' },
      effectiveProviderDepartmentIds: ['dept-b', 'dept-d'],
      nextPrimaryBaseline: 'dept-a',
    })
    expect(reconcileDirectoryDepartments({ ...retained, incomingPrimary: 'dept-e', incomingDepartmentIds: ['dept-e'] }).primary)
      .toEqual({ kind: 'review', effective: 'dept-b', reason: 'diverged' })
  })
})
