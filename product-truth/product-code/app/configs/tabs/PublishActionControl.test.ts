import { createElement } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublishActionControl } from './PublishActionControl'

afterEach(() => cleanup())

describe('PublishActionControl', () => {
  it('disables repeat publishing while the row is pending', () => {
    const onPublish = vi.fn()
    const result = render(createElement(PublishActionControl, {
      pending: false,
      onPublish,
    }))

    fireEvent.click(result.getByRole('button', { name: '发布' }))
    expect(onPublish).toHaveBeenCalledTimes(1)

    result.rerender(createElement(PublishActionControl, {
      pending: true,
      onPublish,
    }))
    const pendingButton = result.getByRole('button', { name: '发布中…' }) as HTMLButtonElement
    expect(pendingButton.disabled).toBe(true)
    fireEvent.click(pendingButton)
    expect(onPublish).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['success', '发布成功，当前版本已更新。', 'status'],
    ['error', '发布失败，请修复依赖。', 'alert'],
  ] as const)('renders %s feedback inside the same row', (tone, message, role) => {
    const result = render(createElement(PublishActionControl, {
      pending: false,
      feedback: { tone, message },
      onPublish: () => undefined,
    }))

    expect(result.getByRole(role).textContent).toBe(message)
  })
})
