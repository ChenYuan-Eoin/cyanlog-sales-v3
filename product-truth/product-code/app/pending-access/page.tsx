'use client'

import { useEffect, useState } from 'react'
import { logoutClientSession } from '@/lib/session-client'

export default function PendingAccessPage() {
  const [signingOut, setSigningOut] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [profile, setProfile] = useState<string | null>(null)

  useEffect(() => {
    if (!showProfile) return
    const controller = new AbortController()
    const token = localStorage.getItem('token')
    void fetch('/api/profile', {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Profile unavailable')
      const result = await response.json()
      if (!controller.signal.aborted) {
        const { display_name, title, employee_id } = result.user ?? {}
        const details = [display_name, title, employee_id].filter(value => typeof value === 'string' && value)
        setProfile(details.join(' · ') || '个人信息暂未填写。')
      }
    }).catch(() => {
      if (!controller.signal.aborted) setProfile('暂时无法读取个人信息。')
    })
    return () => controller.abort()
  }, [showProfile])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">等待业务授权</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          您已登录。您暂未获得业务模块权限，请联系管理员配置。
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={signingOut}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => window.location.assign('/')}
          >
            检查权限
          </button>
          <button
            type="button"
            aria-expanded={showProfile}
            aria-controls="pending-profile"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
            onClick={() => {
              if (!showProfile) setProfile(null)
              setShowProfile(!showProfile)
            }}
          >
            个人信息
          </button>
          <button
            type="button"
            disabled={signingOut}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-50"
            onClick={async () => {
              setSigningOut(true)
              await logoutClientSession()
              window.location.assign('/login')
            }}
          >
            {signingOut ? '正在退出…' : '退出登录'}
          </button>
        </div>
        <p id="pending-profile" hidden={!showProfile} role="status" className="mt-3 text-sm text-slate-600">
          {profile ?? '正在读取个人信息…'}
        </p>
      </section>
    </div>
  )
}
