import { createElement } from 'react'
import type { ConfigPublishFeedback } from '../types'

export function PublishActionControl({
  pending,
  feedback,
  onPublish,
}: {
  pending: boolean
  feedback?: ConfigPublishFeedback
  onPublish: () => void
}) {
  return createElement(
    'div',
    { className: 'space-y-2' },
    createElement('button', {
      type: 'button',
      disabled: pending,
      onClick: onPublish,
      className: 'inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
    }, pending ? '发布中…' : '发布'),
    feedback
      ? createElement('div', {
          role: feedback.tone === 'error' ? 'alert' : 'status',
          'aria-live': feedback.tone === 'error' ? 'assertive' : 'polite',
          className: feedback.tone === 'error'
            ? 'rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800'
            : 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800',
        }, feedback.message)
      : null,
  )
}
