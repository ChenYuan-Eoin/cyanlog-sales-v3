'use client'

import { useRef, useState, type FormEvent } from 'react'
import { completeLocalAccountLogin } from '@/lib/auth/local-account-client'

export default function LoginForm() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setPending(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      })
      const result = await response.json() as { token?: unknown }
      if (!response.ok || typeof result.token !== 'string' || !result.token) {
        setError(response.status === 429 ? '登录尝试过于频繁，请稍后再试。'
          : response.status === 401 ? '账号或密码错误，或当前账号暂不可用。'
          : '暂时无法登录，请稍后重试或使用企业登录。')
        return
      }
      completeLocalAccountLogin(result.token)
    } catch {
      setError('暂时无法登录，请稍后重试或使用企业登录。')
    } finally {
      setPassword('')
      submitting.current = false
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} aria-label="账号登录" aria-busy={pending}>
      <div className="form-group">
        <label htmlFor="account-identifier">邮箱或手机号</label>
        <input id="account-identifier" name="username" autoComplete="username" type="text"
          maxLength={254} required value={identifier} disabled={pending}
          onChange={event => setIdentifier(event.target.value)} />
      </div>
      <div className="form-group">
        <label htmlFor="account-password">密码</label>
        <input id="account-password" name="password" autoComplete="current-password" type="password"
          maxLength={72} required value={password} disabled={pending}
          aria-describedby={error ? 'account-login-error' : undefined}
          onChange={event => setPassword(event.target.value)} />
      </div>
      {error ? <p id="account-login-error" role="alert" style={{ color: 'var(--danger-700)', marginBottom: 16 }}>{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={pending} style={{ width: '100%' }}>
        {pending ? '正在登录…' : '使用账号登录'}
      </button>
      <p className="subtitle" style={{ fontSize: 'var(--text-body-sm)', margin: '12px 0 0' }}>
        使用已开通的成员账号。无法登录时请联系管理员。
      </p>
    </form>
  )
}
