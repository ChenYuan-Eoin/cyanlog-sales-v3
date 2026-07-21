import { describe, expect, it } from 'vitest'
import {
  CONTRACTS_LIST_CACHE_PREFIX,
  hasContractTaskSummaryShape,
} from './core-page-warmup'

describe('contract center cache schema', () => {
  it('uses a new cache namespace for the source/version/review task summary', () => {
    expect(CONTRACTS_LIST_CACHE_PREFIX).toBe('contracts:list:v3')
  })

  it('rejects the old comparison-only list shape', () => {
    expect(hasContractTaskSummaryShape({ contract_comparisons: [] })).toBe(false)
  })

  it('accepts the complete business task summary even before a review exists', () => {
    expect(hasContractTaskSummaryShape({
      current_version_id: 'version-1',
      contract_versions: [],
      contract_comparisons: [],
      latest_review: null,
      source_identity: { state: 'ready', ready: true },
    })).toBe(true)
  })
})
