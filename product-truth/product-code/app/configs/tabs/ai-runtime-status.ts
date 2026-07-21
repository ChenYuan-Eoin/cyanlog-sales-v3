import { createElement, useState } from 'react'
import type { AIRuntimeAttempt } from '../types'
import { attemptOutcomeLabel } from './ai-runtime-presentation'

export function RuntimeRefreshButton({
  onRefresh,
  className = '',
}: {
  onRefresh: () => void | Promise<void>
  className?: string
}) {
  const [refreshing, setRefreshing] = useState(false)

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  return createElement('button', {
    type: 'button',
    className: `inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 ${className}`,
    disabled: refreshing,
    'aria-busy': refreshing,
    onClick: () => void refresh(),
  }, refreshing ? '正在检查…' : '检查最新状态')
}

export function RuntimeOverviewUnavailable({
  error,
  onRefresh,
}: {
  error: string
  onRefresh: () => void | Promise<void>
}) {
  if (!error) {
    return createElement('div', {
      role: 'status',
      'aria-live': 'polite',
      className: 'py-8 text-center',
    }, [
      createElement('p', { key: 'message', className: 'text-sm text-slate-600' }, '实际执行路线与调用结果尚未加载。'),
      createElement(RuntimeRefreshButton, { key: 'refresh', onRefresh, className: 'mt-4' }),
    ])
  }

  return createElement('div', {
    role: 'alert',
    'aria-live': 'assertive',
    className: 'rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800',
  }, [
    createElement('div', { key: 'title', className: 'font-semibold' }, '实际执行路线与调用结果加载失败'),
    createElement('p', { key: 'error', className: 'mt-2 break-words leading-6' }, error),
    createElement('p', { key: 'boundary', className: 'mt-2 leading-6' }, '在证据恢复前，不把“已配置”解释为“模型可用”。'),
    createElement(RuntimeRefreshButton, { key: 'refresh', onRefresh, className: 'mt-4 border-rose-300 text-rose-800 hover:bg-rose-100' }),
  ])
}

export function RuntimeAttemptOutcomeStatus({ attempt }: { attempt: AIRuntimeAttempt }) {
  return createElement('span', { 'data-testid': 'runtime-attempt-outcome' }, attemptOutcomeLabel(attempt))
}

export function RuntimeReviewRunStatus({ attempt }: { attempt: AIRuntimeAttempt }) {
  const message = attempt.review_run_id
    ? '已关联本次审核记录，业务结果可以追溯。'
    : attempt.review_run_required
      ? '该产品功能要求关联审核记录；当前记录缺失，不能作为完整业务证据。'
      : '该产品功能不要求关联合同审核记录。'

  return createElement('p', { className: 'mt-3 text-xs text-slate-600' }, message)
}
