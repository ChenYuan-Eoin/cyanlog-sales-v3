'use client'

import { Button } from '@/components/ui/button'
import type { RoleOverrideDecision, RoleOverrideReview } from '@/lib/admin/member-role-override-choice'
import { BUILTIN_PERMISSION_BY_KEY } from '@/lib/permission-catalog'

export function RoleOverrideChoice({ review, busy, onChoose, onCancel }: {
  review: RoleOverrideReview
  busy: boolean
  onChoose: (decision: RoleOverrideDecision) => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800">
      <p className="font-medium">这次角色变更影响以下个人权限设置</p>
      <ul className="list-disc space-y-1 pl-5">
        {review.affected_permissions.map(item => (
          <li key={item.permission_code}>
            {BUILTIN_PERMISSION_BY_KEY.get(item.permission_code)?.label ?? item.permission_code}
            {' · '}{item.retainable ? '可保留' : '需复核'}
          </li>
        ))}
      </ul>
      <p className="text-slate-600">采用新权限会清除列出的个人覆盖。无法保留的授权会停用并待复核。</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>返回</Button>
        <Button type="button" variant="outline" disabled={busy}
          onClick={() => onChoose({ review_revision: review.review_revision, choice: 'new_baseline' })}>采用新权限</Button>
        <Button type="button" disabled={busy}
          onClick={() => onChoose({ review_revision: review.review_revision, choice: 'retain_eligible' })}>保留仍适用的个人覆盖</Button>
      </div>
    </div>
  )
}
