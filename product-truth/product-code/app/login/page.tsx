'use client'

import { useEffect, useState } from 'react'
import { BrandMark } from '@/components/branding/BrandMark'
import { useBranding } from '@/components/branding/BrandingProvider'
import LoginForm from './LoginForm'

type EnterpriseProviderState =
  | { status: 'loading' }
  | { status: 'available'; label: string; startUrl: string }
  | { status: 'unavailable' }

const SSO_ERROR_MESSAGES: Record<string, string> = {
  SSO_NOT_CONFIGURED: '企业统一登录尚未配置，请联系管理员。',
  SSO_CONFIGURATION_AMBIGUOUS: '检测到多个企业登录配置，管理员处理后才能登录。',
  SSO_CONFIGURATION_INVALID: '企业登录配置不可用，请联系管理员重新核对应用凭据。',
  SSO_STATE_INVALID: '企业登录状态已失效，请重新发起登录。',
  SSO_STATE_UNAVAILABLE: '企业登录状态暂时无法校验，请稍后重试。',
  SSO_PROVIDER_DENIED: '纷享登录授权未完成，请重新登录。',
  SSO_PROVIDER_FAILED: '纷享登录服务暂时不可用，请稍后重试。',
  SSO_ENTERPRISE_MISMATCH: '当前纷享员工不属于系统绑定企业，登录已拒绝。',
  SSO_IDENTITY_REJECTED: '当前员工尚未绑定、已停用或存在身份冲突，请联系管理员。',
  SSO_SESSION_FAILED: '系统会话创建失败，请稍后重试。',
  SSO_START_FAILED: '企业登录暂时无法启动，请稍后重试。',
  SSO_CALLBACK_FAILED: '企业登录未完成，请重新登录。',
}

function initialSsoError() {
  if (typeof window === 'undefined') return ''
  const code = new URLSearchParams(window.location.search).get('sso_error') || ''
  return SSO_ERROR_MESSAGES[code] || (code ? '企业登录未完成，请重新登录或联系管理员。' : '')
}

export default function LoginPage() {
  const branding = useBranding()
  const [error] = useState(initialSsoError)
  const [localAccountEnabled, setLocalAccountEnabled] = useState(false)
  const [enterpriseProvider, setEnterpriseProvider] = useState<EnterpriseProviderState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/auth/providers', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { localAccountEnabled?: unknown; providers?: Array<{ id?: unknown; label?: unknown; startUrl?: unknown }> }
        // Local admission has its own server switch, including when SSO is unavailable.
        setLocalAccountEnabled(data.localAccountEnabled === true)
        if (!response.ok) {
          setEnterpriseProvider({ status: 'unavailable' })
          return
        }
        const provider = data.providers?.find(item => item.id === 'fxiaoke')
        if (
          typeof provider?.label !== 'string'
          || provider.startUrl !== '/api/auth/fxiaoke/start'
        ) {
          setEnterpriseProvider({ status: 'unavailable' })
          return
        }
        setEnterpriseProvider({
          status: 'available',
          label: provider.label,
          startUrl: provider.startUrl,
        })
      })
      .catch(error => {
        if (error instanceof Error && error.name === 'AbortError') return
        setEnterpriseProvider({ status: 'unavailable' })
      })
    return () => controller.abort()
  }, [])

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

        <div className="hero-illustration">
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

          <div style={{ marginTop: 32 }}>
            {localAccountEnabled ? (
              <div style={{ marginBottom: 24 }}>
                <LoginForm />
                <div className="subtitle" style={{ textAlign: 'center', margin: '24px 0 16px' }}>企业登录</div>
              </div>
            ) : null}
            {enterpriseProvider.status === 'available' ? (
              <a
                className="btn btn-primary"
                href={enterpriseProvider.startUrl}
                style={{ display: 'flex', justifyContent: 'center', textDecoration: 'none' }}
              >
                使用{enterpriseProvider.label}登录
              </a>
            ) : enterpriseProvider.status === 'loading' ? (
              <div aria-live="polite" className="subtitle">正在检查企业统一登录…</div>
            ) : (
              <div className="subtitle">企业统一登录尚未就绪，请联系管理员完成配置。</div>
            )}

            {error && (
              <div role="alert" aria-live="polite" style={{
                padding: '12px 16px',
                background: 'var(--danger-100)',
                color: 'var(--danger-700)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-body-sm)',
                marginTop: 16,
                marginBottom: 8,
              }}>
                {error}
              </div>
            )}

          </div>
        </div>

        <p className="bottom-notice">
          仅授权成员可访问机会、报价、合同、审批和协同记录。
        </p>
      </div>

    </div>
  )
}
