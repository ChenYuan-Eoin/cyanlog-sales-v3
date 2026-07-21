import { describe, expect, it } from 'vitest'
import {
  buildContractCompareHref,
  buildContractNewReviewHref,
  buildContractsCenterHref,
  buildContractWorkbenchPanelHref,
  buildContractWorkbenchHref,
  buildCompareBaselineUploadHref,
  buildCustomerReturnUploadHref,
  normalizeContractWorkbenchPanel,
} from './review-navigation'

describe('contract review navigation', () => {
  it('keeps contract center as the stable list destination', () => {
    expect(buildContractsCenterHref()).toBe('/contracts')
  })

  it('marks new review creation as a workbench entry by default', () => {
    expect(buildContractNewReviewHref()).toBe('/contracts/new?from=workbench')
  })

  it('preserves workbench panel and entry source on review links', () => {
    expect(buildContractWorkbenchHref('contract-1', {
      panel: 'evidence',
      from: 'list',
    })).toBe('/contracts/contract-1?panel=evidence&from=list')
  })

  it('returns from compare to the canonical default review route', () => {
    expect(buildContractWorkbenchHref('contract-1', {
      panel: 'review',
      from: 'compare',
    })).toBe('/contracts/contract-1?from=compare')
  })

  it('keeps compare results bound to a specific comparison id when present', () => {
    expect(buildContractCompareHref('contract-1', {
      from: 'workbench',
      comparisonId: 'cmp-1',
    })).toBe('/contracts/contract-1/compare?from=workbench&comparison_id=cmp-1')
  })

  it('can return to compare setup without locking a comparison result', () => {
    expect(buildContractCompareHref('contract-1', {
      from: 'compare',
    })).toBe('/contracts/contract-1/compare?from=compare')
  })

  it('routes customer return upload into the version flow before compare', () => {
    expect(buildCustomerReturnUploadHref('contract-1')).toBe('/contracts/contract-1/edit?intent=customer-return&next=compare')
  })

  it('routes baseline upload into the compare baseline flow', () => {
    expect(buildCompareBaselineUploadHref('contract-1')).toBe('/contracts/contract-1/edit?intent=compare-baseline&next=compare')
  })

  it('treats missing, invalid and explicit review queries as the default review panel', () => {
    expect(normalizeContractWorkbenchPanel(null)).toBe('review')
    expect(normalizeContractWorkbenchPanel('unknown')).toBe('review')
    expect(normalizeContractWorkbenchPanel('review')).toBe('review')
    expect(normalizeContractWorkbenchPanel('evidence')).toBe('evidence')
  })

  it('preserves unrelated query state while only explicit non-review panels remain in the URL', () => {
    const evidenceHref = buildContractWorkbenchPanelHref(
      'contract-1',
      'from=list&comparison_id=compare-1',
      'evidence'
    )
    expect(evidenceHref).toBe('/contracts/contract-1?from=list&comparison_id=compare-1&panel=evidence')

    const reviewHref = buildContractWorkbenchPanelHref(
      'contract-1',
      'from=list&comparison_id=compare-1&panel=evidence',
      'review'
    )
    expect(reviewHref).toBe('/contracts/contract-1?from=list&comparison_id=compare-1')
  })
})
