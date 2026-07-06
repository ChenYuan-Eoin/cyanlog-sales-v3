import { describe, expect, it } from 'vitest'
import {
  buildContractCompareHref,
  buildContractNewReviewHref,
  buildContractsCenterHref,
  buildContractWorkbenchHref,
  buildCompareBaselineUploadHref,
  buildCustomerReturnUploadHref,
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

  it('returns from compare to the review panel instead of a contextless detail page', () => {
    expect(buildContractWorkbenchHref('contract-1', {
      panel: 'review',
      from: 'compare',
    })).toBe('/contracts/contract-1?panel=review&from=compare')
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
})
