'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { persistClientSession } from '@/lib/session-client'
import { primeHomeInitialData, primeHomeInitialSnapshot, primeHomeProfile } from '@/lib/home-data-client'
import { scheduleCorePageWarmup } from '@/lib/core-page-warmup'
import { BrandMark } from '@/components/branding/BrandMark'
import { useBranding } from '@/components/branding/BrandingProvider'

export default function LoginPage() {
  const router = useRouter()
  const branding = useBranding()
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

      persistClientSession(data.token)
      if (!data.mustChangePassword) {
        primeHomeProfile(data.token, data.user)
        primeHomeInitialSnapshot(data.token, data.user, data.initialDashboard)
        primeHomeInitialData(data.token)
        scheduleCorePageWarmup(data.token, (href) => router.prefetch(href))
        router.prefetch('/')
      }

      router.replace(data.mustChangePassword ? '/change-password' : '/')
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
          <BrandMark size={44} className="brand-logo" variant="symbol" surface="dark" />
          <div>
            <div>{branding.brandName}</div>
            <div style={{ fontSize: 'var(--text-caption)', color: 'var(--fg-on-dark-2)', fontWeight: 400 }}>
              {branding.productSubtitle}
            </div>
          </div>
        </div>

        <div className="hero-content">
          <div className="eyebrow">访问验证</div>
          <h1>{branding.productTitle}</h1>
          <p>从客户接触到合同审批，关键节点、参与人和材料在同一套业务界面里流转。验证通过后进入工作台首页。</p>
        </div>

        <div className="hero-illustration" style={{ position: 'absolute', bottom: 40, right: 48, width: 380, height: 320 }}>
          {/* Streamline-style Marketing Keynote Illustration */}
          <svg viewBox="0 0 380 320" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Background elements */}
            <circle cx="300" cy="80" r="60" fill="rgba(6,182,212,0.1)" />
            <circle cx="60" cy="200" r="40" fill="rgba(99,102,241,0.08)" />

            {/* Podium/Stage */}
            <rect x="140" y="180" width="120" height="100" rx="8" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
            <rect x="150" y="160" width="100" height="20" rx="4" fill="rgba(255,255,255,0.08)" />

            {/* Screen/Display */}
            <rect x="100" y="40" width="180" height="100" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
            <rect x="115" y="55" width="150" height="70" rx="6" fill="rgba(6,182,212,0.15)" />

            {/* Chart elements on screen */}
            <rect x="135" y="85" width="30" height="25" rx="2" fill="rgba(6,182,212,0.4)" />
            <rect x="175" y="75" width="30" height="35" rx="2" fill="rgba(99,102,241,0.4)" />
            <rect x="215" y="90" width="30" height="20" rx="2" fill="rgba(34,197,94,0.4)" />

            {/* Person silhouette */}
            <circle cx="190" cy="140" r="25" fill="rgba(6,182,212,0.25)" />
            <path d="M165,170 Q165,155 185,155 L195,155 Q215,155 215,170 L215,200 L165,200 Z" fill="rgba(6,182,212,0.2)" />

            {/* Hand gestures */}
            <circle cx="140" cy="130" r="15" fill="rgba(99,102,241,0.15)" />
            <circle cx="250" cy="140" r="12" fill="rgba(34,197,94,0.15)" />

            {/* Decorative dots */}
            <circle cx="320" cy="180" r="4" fill="rgba(6,182,212,0.3)" />
            <circle cx="335" cy="160" r="6" fill="rgba(99,102,241,0.25)" />
            <circle cx="50" cy="120" r="5" fill="rgba(34,197,94,0.2)" />
            <circle cx="40" cy="250" r="8" fill="rgba(6,182,212,0.15)" />

            {/* Abstract shapes representing audience/seats */}
            <rect x="40" y="260" width="20" height="30" rx="4" fill="rgba(255,255,255,0.03)" />
            <rect x="70" y="265" width="20" height="25" rx="4" fill="rgba(255,255,255,0.03)" />
            <rect x="290" y="260" width="20" height="30" rx="4" fill="rgba(255,255,255,0.03)" />
            <rect x="320" y="265" width="20" height="25" rx="4" fill="rgba(255,255,255,0.03)" />
          </svg>
        </div>
      </div>

      {/* Right Login Panel */}
      <div className="login-panel">
        <div>
          <div className="tag">企业工作空间</div>

          <h1>{branding.loginTitle}</h1>
          <p className="subtitle">{branding.loginSubtitle}</p>

          <form
            method="post"
            action="/api/auth/login"
            onSubmit={handleSubmit}
            style={{ marginTop: 32 }}
            autoComplete="on"
          >
            <div className="form-group">
              <label htmlFor="login-email">企业邮箱</label>
              <input
                id="login-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                autoComplete="username"
                inputMode="email"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-password">密码</label>
              <input
                id="login-password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
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
              {loading ? '登录中...' : '进入工作台'}
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

    </div>
  )
}
