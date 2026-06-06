'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '登录失败')
        return
      }

      document.cookie = `token=${data.token}; path=/; max-age=86400`
      localStorage.setItem('token', data.token)

      router.push(data.mustChangePassword ? '/change-password' : '/')
      router.refresh()
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="shell-row min-h-screen">
      {/* Left Hero Panel */}
      <div className="hero-dark">
        <div className="brand">
          <div className="brand-logo">CY</div>
          <div>
            <div>Cyanlog</div>
            <div style={{ fontSize: 'var(--text-caption)', color: 'var(--fg-on-dark-2)', fontWeight: 400 }}>
              企业销售支撑平台
            </div>
          </div>
        </div>

        <div className="hero-content">
          <div className="eyebrow">访问验证</div>
          <h1>把销售流程<br />装进同一个工作空间。</h1>
          <p>从客户接触到合同审批，所有节点、所有人、所有材料在一个空间内推进。验证通过后进入华东作战空间。</p>
        </div>

        <div className="hero-illustration" style={{
          position: 'absolute',
          bottom: 60,
          right: 48,
          width: 320,
          height: 240,
          opacity: 0.6,
        }}>
          {/* Illustrated laptop and person - simplified CSS representation */}
          <div style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            background: 'linear-gradient(135deg, rgba(6,182,212,0.1) 0%, transparent 50%)',
            borderRadius: 'var(--radius-xl)',
          }}>
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 200,
              height: 140,
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
              <div style={{
                position: 'absolute',
                top: 20,
                left: 20,
                right: 20,
                height: 80,
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 'var(--radius-sm)',
              }} />
            </div>
            <div style={{
              position: 'absolute',
              top: 40,
              right: 40,
              width: 56,
              height: 56,
              background: 'linear-gradient(135deg, var(--cyan-500), var(--cyan-700))',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Right Login Panel */}
      <div className="login-panel">
        <div>
          <div className="tag">企业工作空间</div>

          <h1>企业登录</h1>
          <p className="subtitle">使用企业邮箱或 SSO 完成验证。通过后进入首页。</p>

          <form onSubmit={handleSubmit} style={{ marginTop: 32 }}>
            <div className="form-group">
              <label>企业邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
              />
            </div>

            <div className="form-group">
              <label>密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div style={{
                padding: '12px 16px',
                background: 'var(--danger-100)',
                color: 'var(--danger-700)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-body-sm)',
                marginBottom: 16,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ marginTop: 8, marginBottom: 12 }}
            >
              {loading ? '登录中...' : '进入首页'}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              disabled
              title="请联系管理员开通企业 SSO 账号"
            >
              使用企业 SSO 登录（请联系管理员开通）
            </button>
          </form>
        </div>

        <p className="bottom-notice">
          仅授权成员可访问机会、报价、合同、审批和协同记录。
        </p>
      </div>

      {/* Floating Navigation Pill */}
      <div className="nav-pill">
        <Link href="/" prefetch={false}>CYANLOG</Link>
        <Link href="/login" className="active" prefetch={false}>登录</Link>
        <Link href="/quotes" prefetch={false}>报价</Link>
        <Link href="/contracts" prefetch={false}>合同</Link>
      </div>
    </div>
  )
}
