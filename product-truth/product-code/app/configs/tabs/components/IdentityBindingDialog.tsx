'use client'

import { useEffect, useState } from 'react'
import { FingerprintIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { OrgSummaryUser } from '../../types'

interface IdentityBindingDialogProps {
  user: OrgSummaryUser | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onBound?: () => void | Promise<void>
}

export function IdentityBindingDialog({
  user,
  open,
  onOpenChange,
  onBound,
}: IdentityBindingDialogProps) {
  const [externalSubject, setExternalSubject] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [bound, setBound] = useState(false)

  useEffect(() => {
    if (!open) {
      setExternalSubject('')
      setSaving(false)
      setError('')
      setBound(false)
    }
  }, [open])

  async function bindIdentity(event: React.FormEvent) {
    event.preventDefault()
    if (!user) return
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(externalSubject.trim())) {
      setError('请输入纷享员工 openUserId，只允许字母、数字、下划线和短横线。')
      return
    }

    setSaving(true)
    setError('')
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/admin/users/${user.id}/identity-binding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ external_subject: externalSubject.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload?.error || '身份绑定失败')
        return
      }
      setBound(true)
      await onBound?.()
    } catch {
      setError('网络错误，请稍后重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FingerprintIcon className="h-5 w-5" />
            绑定历史 ICU 账号
          </DialogTitle>
          <DialogDescription>
            仅在历史 ICU 账号未由纷享目录关联时使用。普通员工通过目录同步自动关联，无需逐人填写 openUserId。不会按手机号或姓名自动匹配。
          </DialogDescription>
        </DialogHeader>

        {bound ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            纷享身份已绑定。该成员下次可从纷享 OAuth 登录。
          </div>
        ) : (
          <form className="space-y-4" onSubmit={bindIdentity}>
            <label className="block text-sm font-medium text-slate-700">
              纷享员工 openUserId
              <Input
                className="mt-1"
                value={externalSubject}
                onChange={(event) => setExternalSubject(event.target.value.trim())}
                autoComplete="off"
                required
              />
            </label>
            <p className="text-xs leading-5 text-slate-500">
              服务端会从已保存的纷享应用连接读取企业身份，并与 OAuth 返回的 corpId 校验一致。
            </p>
            {error && (
              <div role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                <FingerprintIcon className="mr-2 h-4 w-4" />
                {saving ? '绑定中…' : '确认绑定'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
