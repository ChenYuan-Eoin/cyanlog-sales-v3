'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { error } from '@/lib/toast'

interface UserProfile {
  id: string
  display_name: string
  email: string | null
  phone: string | null
  avatar_url: string | null
  title: string | null
  employee_id: string | null
  last_login_at: string | null
  authMethod?: string | null
  roles?: { code: string }[]
}

export default function ProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const baselineOnly = profile?.roles?.length === 1 && profile.roles[0]?.code === 'FXIAOKE_BASELINE'

  // Form state
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')

  const loadProfile = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth/me', token ? {
        headers: { Authorization: `Bearer ${token}` },
      } : undefined)

      if (res.status === 401) {
        router.push('/login')
        return
      }

      if (!res.ok) {
        throw new Error('读取个人信息失败')
      }

      const data = await res.json() as { user?: UserProfile }
      const user = data.user

      if (user) {
        setProfile(user)
        setDisplayName(user.display_name || '')
        setPhone(user.phone || '')
        setAvatarUrl(user.avatar_url || '')
      }
    } catch (error) {
      console.error('Load profile error:', error)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  async function handleSave() {
    if (!profile) return
    setSaving(true)

    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          displayName,
          phone,
          avatarUrl,
        }),
      })

      if (res.status === 401) {
        router.push('/login')
        return
      }

      const data = await res.json().catch(() => ({} as { user?: UserProfile; error?: string }))
      if (!res.ok) {
        throw new Error(data.error || '保存失败')
      }

      const updatedUser = data.user
      if (!updatedUser) {
        throw new Error('保存失败')
      }

      // Update local state
      setProfile(updatedUser)
      setDisplayName(updatedUser.display_name || '')
      setPhone(updatedUser.phone || '')
      setAvatarUrl(updatedUser.avatar_url || '')
      setEditMode(false)
    } catch (_err) {
      console.error('Save error:', _err)
      const msg = _err instanceof Error ? _err.message : '保存失败，请重试'
      error(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-500">加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-900">个人信息</h1>
          <p className="text-slate-500 mt-1">管理您的账户信息和个人设置</p>
          {profile?.authMethod === 'fxiaoke' && (
            <p className="text-sm text-slate-600 mt-2">本次使用纷享销客身份登录</p>
          )}
        </div>

        {/* Profile Card */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          {/* Avatar Section */}
          <div className="flex items-start gap-6 mb-6 pb-6 border-b">
            <div className="flex-shrink-0">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt="头像"
                  className="w-20 h-20 rounded-full object-cover border-2 border-slate-200"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center">
                  <span className="text-2xl text-slate-400">
                    {displayName?.charAt(0) || '?'}
                  </span>
                </div>
              )}
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-slate-900">{displayName}</h2>
              <p className="text-slate-500 mt-1">
                {profile?.title || '未设置职位'}
              </p>
              <p className="text-sm text-slate-400 mt-2">
                工号：{profile?.employee_id || '未设置'}
              </p>
            </div>
            {!baselineOnly && (
              <button
                onClick={() => setEditMode(!editMode)}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50 transition-colors"
              >
                {editMode ? '取消' : '编辑'}
              </button>
            )}
          </div>

          {/* Edit Form */}
          {editMode ? (
            <div className="space-y-6">
              {/* Avatar Upload */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  头像
                </label>
                <p className="text-xs text-slate-500 mb-3">
                  建议 200×200 像素，支持 PNG、JPG、SVG
                </p>
                <ImageUpload
                  value={avatarUrl}
                  onChange={setAvatarUrl}
                  folder="avatars"
                  accept="image/png,image/jpeg,image/svg+xml"
                  square={true}
                  previewHeight={80}
                />
              </div>

              {/* Display Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  显示名称
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="您的姓名"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  手机号码
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="您的手机号码"
                />
              </div>

              {/* Email (readonly) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  电子邮箱
                </label>
                <input
                  type="email"
                  value={profile?.email || ''}
                  disabled
                  className="w-full px-4 py-2 border rounded-lg bg-slate-50 text-slate-500"
                />
                <p className="text-xs text-slate-400 mt-1">邮箱由系统管理，不可修改</p>
              </div>

              {/* Save Button */}
              <div className="pt-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {saving ? '保存中...' : '保存修改'}
                </button>
              </div>
            </div>
          ) : (
            /* View Mode */
            <div className="space-y-4">
              <div className="flex justify-between py-3 border-b">
                <span className="text-slate-600">显示名称</span>
                <span className="text-slate-900">{displayName}</span>
              </div>
              <div className="flex justify-between py-3 border-b">
                <span className="text-slate-600">电子邮箱</span>
                <span className="text-slate-900">{profile?.email || '未设置'}</span>
              </div>
              <div className="flex justify-between py-3 border-b">
                <span className="text-slate-600">手机号码</span>
                <span className="text-slate-900">{profile?.phone || '未设置'}</span>
              </div>
              <div className="flex justify-between py-3 border-b">
                <span className="text-slate-600">职位</span>
                <span className="text-slate-900">{profile?.title || '未设置'}</span>
              </div>
              <div className="flex justify-between py-3">
                <span className="text-slate-600">上次登录</span>
                <span className="text-slate-900">
                  {profile?.last_login_at
                    ? new Date(profile.last_login_at).toLocaleString('zh-CN')
                    : '未知'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Navigation hint */}
        <div className="mt-6 text-center text-sm text-slate-500">
          <Link href="/" className="hover:text-primary">
            ← 返回工作台
          </Link>
        </div>
      </div>
    </div>
  )
}
