'use client'

import { useRef, useState, type FormEvent } from 'react'
import { completeLocalAccountLogin } from '@/lib/auth/local-account-client'

export default function LoginForm({ onInteract }: { onInteract?: () => void }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({ identifier: '', password: '' })
  const identifierInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    onInteract?.()
    const nextErrors = {
      identifier: identifier.trim() ? '' : '请输入邮箱或手机号。',
      password: password ? '' : '请输入密码。',
    }
    setFieldErrors(nextErrors)
    setError('')
    if (nextErrors.identifier || nextErrors.password) {
      if (nextErrors.identifier) identifierInput.current?.focus()
      else passwordInput.current?.focus()
      return
    }
    submitting.current = true
    setPending(true)
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
          : response.status === 400 ? '登录信息格式不正确，请检查后重试。'
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
    <form onSubmit={submit} onFocusCapture={onInteract} noValidate aria-label="账号登录" aria-busy={pending}>
      <div className="form-group">
        <label htmlFor="account-identifier">邮箱或手机号</label>
        <input ref={identifierInput} id="account-identifier" name="username" autoComplete="username" type="text"
          placeholder="请输入邮箱或手机号"
          maxLength={254} required value={identifier} disabled={pending}
          aria-invalid={fieldErrors.identifier ? true : undefined}
          aria-describedby={fieldErrors.identifier ? 'account-identifier-error' : undefined}
          onChange={event => {
            setIdentifier(event.target.value)
            setFieldErrors(previous => ({ ...previous, identifier: '' }))
            setError('')
          }} />
        {fieldErrors.identifier ? <p id="account-identifier-error" aria-live="polite"
          style={{ color: 'var(--danger-700)', fontSize: 'var(--text-body-sm)', marginTop: 6 }}>{fieldErrors.identifier}</p> : null}
      </div>
      <div className="form-group">
        <label htmlFor="account-password">密码</label>
        <input ref={passwordInput} id="account-password" name="password" autoComplete="current-password" type="password"
          placeholder="请输入密码"
          maxLength={72} required value={password} disabled={pending}
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={fieldErrors.password ? 'account-password-error' : error ? 'account-login-error' : undefined}
          onChange={event => {
            setPassword(event.target.value)
            setFieldErrors(previous => ({ ...previous, password: '' }))
            setError('')
          }} />
        {fieldErrors.password ? <p id="account-password-error" aria-live="polite"
          style={{ color: 'var(--danger-700)', fontSize: 'var(--text-body-sm)', marginTop: 6 }}>{fieldErrors.password}</p> : null}
      </div>
      {error ? <p id="account-login-error" role="alert" style={{ color: 'var(--danger-700)', marginBottom: 16 }}>{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={pending} style={{ width: '100%' }}>
        {pending ? '正在登录…' : '登录'}
      </button>
    </form>
  )
}
