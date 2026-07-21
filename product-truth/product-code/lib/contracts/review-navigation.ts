import type { ReviewWorkflowState } from './review-state-machine'

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

export type ContractListReviewNavigation = {
  href: string
  nextAction: string
  nextActionDescription: string
}

export function buildContractListReviewNavigation(
  contractId: string,
  workflowState: Pick<ReviewWorkflowState, 'nextActionLabel' | 'nextActionDescription'>
): ContractListReviewNavigation {
  return {
    href: buildContractWorkbenchHref(contractId, { from: 'list' }),
    nextAction: workflowState.nextActionLabel,
    nextActionDescription: workflowState.nextActionDescription,
  }
}

export function normalizeContractWorkbenchPanel(
  panel: string | null | undefined
): ContractWorkbenchPanel {
  if (panel === 'summary' || panel === 'assistant' || panel === 'evidence') {
    return panel
  }
  return 'review'
}

export function buildContractWorkbenchPanelHref(
  contractId: string,
  currentSearch: string,
  panel: ContractWorkbenchPanel
) {
  const params = new URLSearchParams(currentSearch)
  if (panel === 'review') {
    params.delete('panel')
  } else {
    params.set('panel', panel)
  }
  return appendSearch(`/contracts/${contractId}`, params)
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
  if (options.panel && options.panel !== 'review') params.set('panel', options.panel)
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
