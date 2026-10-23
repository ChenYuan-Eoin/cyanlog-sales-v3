import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AcceptInvitationPage from './page'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  replace.mockReset()
})

describe('AcceptInvitationPage', () => {
  it('requires matching passwords before submitting', async () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<AcceptInvitationPage />)
    fireEvent.change(screen.getByLabelText('激活码'), { target: { value: 'token-1' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'Correct-Horse-2026' } })
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'Different-Horse-2026' } })
    fireEvent.click(screen.getByRole('button', { name: '激活账号' }))

    expect(await screen.findByText('两次输入的密码不一致。')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('submits the one-time code and chosen password', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AcceptInvitationPage />)
    fireEvent.change(screen.getByLabelText('激活码'), { target: { value: 'token-1' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'Correct-Horse-2026' } })
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'Correct-Horse-2026' } })
    fireEvent.click(screen.getByRole('button', { name: '激活账号' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'token-1', password: 'Correct-Horse-2026' }),
    }))
    expect(await screen.findByText(/账号已激活/)).toBeInTheDocument()
  })
})
