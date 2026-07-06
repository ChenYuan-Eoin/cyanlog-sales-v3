export type ContractWorkbenchPanel = 'review' | 'summary' | 'assistant' | 'evidence'

export type ContractNavigationSource =
  | 'workbench'
  | 'list'
  | 'compare'
  | 'upload'
  | 'detail'
  | 'direct'

function appendSearch(pathname: string, params: URLSearchParams) {
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function buildContractsCenterHref() {
  return '/contracts'
}

export function buildContractNewReviewHref(source: ContractNavigationSource = 'workbench') {
  const params = new URLSearchParams()
  params.set('from', source)
  return appendSearch('/contracts/new', params)
}

export function buildContractWorkbenchHref(
  contractId: string,
  options: {
    panel?: ContractWorkbenchPanel
    from?: ContractNavigationSource
  } = {}
) {
  const params = new URLSearchParams()
  if (options.panel) params.set('panel', options.panel)
  if (options.from) params.set('from', options.from)
  return appendSearch(`/contracts/${contractId}`, params)
}

export function buildContractCompareHref(
  contractId: string,
  options: {
    from?: ContractNavigationSource
    comparisonId?: string | null
  } = {}
) {
  const params = new URLSearchParams()
  if (options.from) params.set('from', options.from)
  if (options.comparisonId) params.set('comparison_id', options.comparisonId)
  return appendSearch(`/contracts/${contractId}/compare`, params)
}

export function buildCustomerReturnUploadHref(contractId: string, next: 'compare' | 'review' = 'compare') {
  const params = new URLSearchParams()
  params.set('intent', 'customer-return')
  params.set('next', next)
  return appendSearch(`/contracts/${contractId}/edit`, params)
}

export function buildCompareBaselineUploadHref(contractId: string) {
  const params = new URLSearchParams()
  params.set('intent', 'compare-baseline')
  params.set('next', 'compare')
  return appendSearch(`/contracts/${contractId}/edit`, params)
}
