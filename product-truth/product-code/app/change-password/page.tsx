'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [checking, setChecking] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      const token = localStorage.getItem('token')
      if (!token) {
        router.replace('/login')
        return
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!res.ok) {
          router.replace('/login')
          return
        }

        const data = await res.json()
        if (!data.user?.mustChangePassword && !data.user?.must_change_password) {
          router.replace('/')
          return
        }
      } catch {
        router.replace('/login')
        return
      } finally {
        if (!cancelled) {
          setChecking(false)
        }
      }
    }

    void loadProfile()

    return () => {
      cancelled = true
    }
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }

    if (newPassword.length < 8) {
      setError('新密码至少 8 位')
      return
    }

    setLoading(true)

    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '修改密码失败')
        return
      }

      router.replace('/')
      router.refresh()
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="content-area" style={{ maxWidth: 560, margin: '0 auto', paddingTop: 48 }}>
      <div className="side-card">
        <div className="tag">首次登录</div>
        <h1 style={{ marginTop: 12 }}>修改初始密码</h1>
        <p className="subtitle" style={{ marginTop: 8 }}>
          管理员下发的是临时密码。修改完成前，系统不会开放其他页面和接口。
        </p>

        {checking ? (
          <div style={{ marginTop: 24, color: 'var(--fg-3)' }}>校验登录状态中...</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ marginTop: 24 }}>
            <div className="form-group">
              <label>当前密码</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="输入当前临时密码"
                required
              />
            </div>

            <div className="form-group">
              <label>新密码</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 8 位"
                required
              />
            </div>

            <div className="form-group">
              <label>确认新密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入新密码"
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

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? '提交中...' : '确认修改并进入系统'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
