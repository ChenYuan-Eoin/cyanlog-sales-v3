import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { IntrinsicCardStack } from './IntrinsicCardStack'

afterEach(() => cleanup())

describe('IntrinsicCardStack', () => {
  it.each([0, 1, 14, 50])('renders %i cards in a single intrinsic-height flow', (count) => {
    const cards = Array.from({ length: count }, (_, index) => createElement(
      'article',
      { key: `card-${index}` },
      `card ${index}`,
    ))
    const result = render(createElement(IntrinsicCardStack, { label: '测试资产列表' }, cards))
    const stack = result.getByLabelText('测试资产列表')

    expect(stack.getAttribute('data-layout-card-count')).toBe(String(count))
    expect(stack.children).toHaveLength(count)
    expect(stack.className).toContain('space-y-3')
    expect(stack.className).not.toContain('grid')
  })
})
