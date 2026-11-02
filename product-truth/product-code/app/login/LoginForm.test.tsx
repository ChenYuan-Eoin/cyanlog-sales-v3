import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
const complete = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/local-account-client', () => ({ completeLocalAccountLogin: complete }))
import LoginForm from './LoginForm'
function fill() {
  fireEvent.change(screen.getByLabelText('邮箱或手机号'), { target: { value: 'member@example.test' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: ' example-password ' } })
}
beforeEach(() => complete.mockReset())
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('existing account login form', () => {
  it('uses the current-password form and completes only a successful server session', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ token: 'example-local-session' }))
    vi.stubGlobal('fetch', fetcher)
    render(<LoginForm />)
    fill()
    expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'current-password')
    fireEvent.submit(screen.getByRole('form', { name: '账号登录' }))
    await waitFor(() => expect(complete).toHaveBeenCalledWith('example-local-session'))
    expect(fetcher).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST', credentials: 'same-origin',
      body: JSON.stringify({ identifier: 'member@example.test', password: ' example-password ' }),
    }))
  })
  it('shows a generic rejection without persisting any session or exposing server text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'private implementation detail' }, { status: 401 })))
    render(<LoginForm />)
    fill()
    fireEvent.submit(screen.getByRole('form', { name: '账号登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码错误，或当前账号暂不可用。')
    expect(screen.queryByText('private implementation detail')).not.toBeInTheDocument()
    expect(complete).not.toHaveBeenCalled()
    expect(screen.getByLabelText('密码')).toHaveValue('')
    expect(screen.queryByRole('link', { name: /注册|重置|忘记密码/ })).not.toBeInTheDocument()
  })
  it('prevents a second submission while the first request is pending', async () => {
    let finish: (response: Response) => void = () => {}
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetcher)
    render(<LoginForm />)
    fill()
    const form = screen.getByRole('form', { name: '账号登录' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '正在登录…' })).toBeDisabled()
    finish(Response.json({}, { status: 429 }))
    expect(await screen.findByRole('alert')).toHaveTextContent('登录尝试过于频繁')
  })
})
