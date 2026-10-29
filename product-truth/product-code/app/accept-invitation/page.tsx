'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BadgeCheckIcon, KeyRoundIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function AcceptInvitationPage() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    const initialToken = new URLSearchParams(window.location.search).get('token')
    if (initialToken) setToken(initialToken)
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const response = await fetch('/api/auth/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload?.error || '激活失败')
        return
      }
      setAccepted(true)
      window.setTimeout(() => router.replace('/login'), 1200)
    } catch {
      setError('网络错误，请稍后重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
            <KeyRoundIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">激活成员账号</h1>
            <p className="text-sm text-slate-500">确认成员关系后，使用企业统一登录进入系统。</p>
          </div>
        </div>

        {accepted ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <BadgeCheckIcon className="mr-2 inline h-4 w-4" />
            账号已激活，正在前往登录页。
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <label className="block text-sm font-medium text-slate-700">
              激活码
              <Input
                className="mt-1"
                value={token}
                autoComplete="one-time-code"
                onChange={(event) => setToken(event.target.value.trim())}
                required
              />
            </label>
            {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <Button className="w-full" type="submit" disabled={saving}>
              {saving ? '激活中...' : '激活账号'}
            </Button>
          </form>
        )}
      </div>
    </main>
  )
}
