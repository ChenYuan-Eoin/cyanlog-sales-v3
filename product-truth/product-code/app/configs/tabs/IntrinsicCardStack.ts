import { Children, createElement, type ReactNode } from 'react'

export function IntrinsicCardStack({
  children,
  label,
}: {
  children?: ReactNode
  label: string
}) {
  const count = Children.count(children)

  return createElement('div', {
    'aria-label': label,
    'className': 'space-y-3',
    'data-layout-card-count': count,
  }, children)
}
