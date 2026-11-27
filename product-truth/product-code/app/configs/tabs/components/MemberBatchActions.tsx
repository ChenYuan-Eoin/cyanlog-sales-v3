'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  readRoleOverrideReview, ROLE_PERMISSION_REVIEW_REQUIRED, type RoleOverrideDecision, type RoleOverrideReview,
} from '@/lib/admin/member-role-override-choice'
import type { OrgSummaryRole, OrgSummaryUser } from '../../types'

const actionLabels = {
  suspend: '批量停用账号',
  offboard: '批量办理离职',
  remove_membership: '批量移出当前组织',
  assign_roles: '批量分配角色',
}

type BatchAction = keyof typeof actionLabels

type BatchResult =
  | { user_id: string; ok: true; pending?: boolean }
  | { user_id: string; ok: false; error: string; code?: string; review?: RoleOverrideReview }

interface ReviewQueue {
  roleIds: string[]
  memberNames: Map<string, string>
  pending: Array<{ userId: string; review: RoleOverrideReview | null }>
}

interface MemberBatchActionsProps {
  orgId: string
  members: OrgSummaryUser[]
  roles: OrgSummaryRole[]
  canSuspend: boolean
  canOffboard: boolean
  canRemoveMembership: boolean
  canAssignRoles: boolean
  authHeaders: () => HeadersInit
  onClearSelection: () => void
  onSucceeded: (userIds: string[]) => void
  onRefresh?: () => void | Promise<void>
}

const requestLimit = 200

function parseResults(value: unknown, userIds: string[]): BatchResult[] | null {
  if (!Array.isArray(value) || value.length !== userIds.length) return null
  const remainingIds = new Set(userIds)
  const results: BatchResult[] = []
  for (const entry of value) {
    if (typeof entry?.user_id !== 'string' || !remainingIds.delete(entry.user_id)) return null
    if (entry.ok !== true && (entry.ok !== false || typeof entry.error !== 'string')) return null
    if (entry.ok) {
      results.push({ user_id: entry.user_id, ok: true, pending: entry.pending === true })
    } else {
      const review = entry.code === ROLE_PERMISSION_REVIEW_REQUIRED ? readRoleOverrideReview(entry) : undefined
      if (entry.code === ROLE_PERMISSION_REVIEW_REQUIRED && !review) return null
      results.push({ user_id: entry.user_id, ok: false, error: entry.error, code: entry.code, review })
    }
  }
  return results
}

export function MemberBatchActions({
  orgId, members, roles, canSuspend, canOffboard, canRemoveMembership, canAssignRoles, authHeaders, onClearSelection, onSucceeded, onRefresh,
}: MemberBatchActionsProps) {
  const [action, setAction] = useState<BatchAction | null>(null)
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([])
  const [reviewQueue, setReviewQueue] = useState<ReviewQueue | null>(null)
  const [reviewChoices, setReviewChoices] = useState<Record<string, RoleOverrideDecision['choice']>>({})
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [feedback, setFeedback] = useState<{
    action: BatchAction; succeeded: number; pending: number; needsReview: number
    failures: Array<{ name: string; error: string }>; message?: string
  } | null>(null)
  const roleIds = selectedRoleIds.filter(roleId => roles.some(role => role.id === roleId))
  const waitingForChoices = reviewQueue?.pending.some(member => member.review && !reviewChoices[member.userId]) ?? false

  function open(nextAction: BatchAction) {
    setSelectedRoleIds([])
    setReviewQueue(null)
    setReviewChoices({})
    setAction(nextAction)
  }

  async function apply() {
    if (submitting.current || !action || waitingForChoices || (!reviewQueue && !members.length)
      || (action === 'assign_roles' && !reviewQueue && !roleIds.length)) return
    submitting.current = true
    setBusy(true)
    if (!reviewQueue) setFeedback(null)
    const memberNames = reviewQueue?.memberNames ?? new Map(members.map(member => [member.id, member.display_name]))
    const userIds = reviewQueue?.pending.map(member => member.userId) ?? [...memberNames.keys()]
    const requestedRoleIds = reviewQueue?.roleIds ?? roleIds
    const decisions = new Map(reviewQueue?.pending.flatMap(({ userId, review }) => review && reviewChoices[userId] ? [[userId, {
      user_id: userId, review_revision: review.review_revision, choice: reviewChoices[userId],
    }]] : []))
    const results: BatchResult[] = []
    let message: string | undefined
    let unconfirmed = false

    try {
      for (let start = 0; start < userIds.length; start += requestLimit) {
        const chunk = userIds.slice(start, start + requestLimit)
        const personalPermissions = chunk.flatMap(id => {
          const decision = decisions.get(id)
          return decision ? [decision] : []
        })
        const response = await fetch('/api/admin/users/batch', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            expected_org_id: orgId,
            action,
            user_ids: chunk,
            ...(action === 'assign_roles' ? {
              role_ids: requestedRoleIds, ...(personalPermissions.length > 0 ? { personal_permissions: personalPermissions } : {}),
            } : {}),
          }),
        })
        const result = await response.json().catch(() => null)
        if (!response.ok && ([400, 401, 403, 409].includes(response.status) || result?.code === 'MEMBER_BATCH_UPDATING')) {
          message = typeof result?.error === 'string' ? result.error : '批量操作被拒绝。'
          break
        }
        const confirmed = parseResults(result?.results, chunk)
        if (!response.ok || !confirmed) throw new Error('未能确认本批处理结果')
        results.push(...confirmed)
      }
    } catch {
      message = '未能确认本批处理结果，请在核对成员最新状态后重试。'
      unconfirmed = true
    }

    const successful = results.filter(result => result.ok)
    const pending = action === 'assign_roles' ? results.flatMap<ReviewQueue['pending'][number]>(result => {
      if (result.ok) return []
      if (result.review) return [{ userId: result.user_id, review: result.review }]
      if (reviewQueue && result.code === 'ROLE_OVERRIDE_REVIEW_CHANGED') return [{ userId: result.user_id, review: null }]
      return []
    }) : []
    const pendingIds = new Set(pending.map(member => member.userId))
    const failures = results.flatMap(result => result.ok || pendingIds.has(result.user_id) ? [] : [{
      name: memberNames.get(result.user_id) || '成员',
      error: result.error,
    }])
    if (results.length < userIds.length) {
      const remaining = userIds.length - results.length
      message = `${message || ''}还有 ${remaining} 人${unconfirmed ? '的结果未确认或尚未处理' : '尚未处理'}。`
    }
    if (pending.length === 0) setAction(null)
    setReviewQueue(pending.length > 0 ? { pending, roleIds: requestedRoleIds, memberNames } : null)
    setReviewChoices({})
    setFeedback(previous => ({
      action,
      succeeded: (reviewQueue ? previous?.succeeded ?? 0 : 0) + successful.length,
      pending: (reviewQueue ? previous?.pending ?? 0 : 0) + successful.filter(result => result.pending === true).length,
      needsReview: pending.length,
      failures: [...(reviewQueue ? previous?.failures ?? [] : []), ...failures],
      message: [reviewQueue ? previous?.message : undefined, message].filter(Boolean).join(' '),
    }))
    if (successful.length) onSucceeded(successful.map(result => result.user_id))
    try {
      if (successful.length || unconfirmed) await onRefresh?.()
    } catch {
      setFeedback(previous => previous && {
        ...previous,
        message: `${previous.message || ''}暂时无法读取更新后的成员名单。`,
      })
    } finally {
      setBusy(false)
      submitting.current = false
    }
  }

  return <>
    {members.length > 0 && (
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-slate-50 px-3 py-2">
        <span className="mr-1 text-sm font-medium text-slate-700">已选 {members.length} 人</span>
        {canSuspend && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => open('suspend')}>
            {actionLabels.suspend}
          </Button>
        )}
        {canOffboard && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => open('offboard')}>
            {actionLabels.offboard}
          </Button>
        )}
        {canRemoveMembership && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => open('remove_membership')}>
            {actionLabels.remove_membership}
          </Button>
        )}
        {canAssignRoles && (
          <Button type="button" size="sm" variant="outline" disabled={busy || !roles.length} onClick={() => open('assign_roles')}>
            {actionLabels.assign_roles}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onClearSelection}>清空选择</Button>
      </div>
    )}
    {feedback && (
      <div role="status" className="space-y-1 rounded-md border px-3 py-2 text-sm text-slate-700">
        <p>{actionLabels[feedback.action]} · 成功 {feedback.succeeded} 人，失败 {feedback.failures.length} 人
          {feedback.pending > 0 && `，${feedback.pending} 人待首次登录生效`}
          {feedback.needsReview > 0 && `，${feedback.needsReview} 人待核对个人权限`}
        </p>
        {feedback.message && <p>{feedback.message}</p>}
        {feedback.failures.length > 0 && (
          <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-5">
            {feedback.failures.map(({ name, error }, index) => <li key={index}>{name} · {error}</li>)}
          </ul>
        )}
      </div>
    )}
    <Dialog open={action !== null} onOpenChange={open => { if (!open && !busy) setAction(null) }}>
      {action && (
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>{actionLabels[action]}</DialogTitle>
            <DialogDescription>
              {action === 'assign_roles' && (reviewQueue
                ? `已保存 ${feedback?.succeeded ?? 0} 人，${reviewQueue.pending.length} 人的个人权限待核对。`
                : `为已选的 ${members.length} 名成员添加角色，保留其已有角色。`)}
              {action === 'suspend' && `停用已选的 ${members.length} 名成员的 ICU 登录。`}
              {action === 'offboard' && `为已选的 ${members.length} 名成员办理 ICU 离职，结束其组织成员关系及访问。外部人事记录由来源系统维护。`}
              {action === 'remove_membership' && `从当前组织移出已选的 ${members.length} 名成员。成员账号和历史记录保留，无法移出的成员会逐一反馈原因。`}
            </DialogDescription>
          </DialogHeader>
          {action === 'assign_roles' && !reviewQueue && (
            <fieldset disabled={busy} className="grid max-h-64 gap-3 overflow-auto p-1">
              <legend className="sr-only">选择组织角色</legend>
              {roles.map(role => (
                <label key={role.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={roleIds.includes(role.id)}
                    disabled={busy}
                    onCheckedChange={checked => setSelectedRoleIds(previous => checked === true
                      ? [...previous, role.id] : previous.filter(id => id !== role.id))}
                  />
                  {role.name}
                </label>
              ))}
            </fieldset>
          )}
          {reviewQueue && (
            <div className="grid max-h-64 gap-3 overflow-auto p-1">
              {reviewQueue.pending.map(({ userId, review }) => (
                <fieldset key={userId} disabled={busy} className="space-y-2 rounded-md border px-3 py-2">
                  <legend className="px-1 text-sm font-medium">{reviewQueue.memberNames.get(userId) || '成员'}</legend>
                  {review ? (
                    <>
                      <p className="text-sm text-slate-600">
                        {review.affected_permissions.length} 项个人权限受影响，
                        {review.affected_permissions.filter(permission => permission.retainable).length} 项可保留。
                      </p>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name={userId} checked={reviewChoices[userId] === 'new_baseline'}
                          onChange={() => setReviewChoices(previous => ({ ...previous, [userId]: 'new_baseline' }))} />
                        按调整后的角色权限生效
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name={userId} checked={reviewChoices[userId] === 'retain_eligible'}
                          disabled={!review.affected_permissions.some(permission => permission.retainable)}
                          onChange={() => setReviewChoices(previous => ({ ...previous, [userId]: 'retain_eligible' }))} />
                        保留符合条件的个人权限
                      </label>
                    </>
                  ) : <p className="text-sm text-slate-600">权限已变化，需要重新核对。</p>}
                </fieldset>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setAction(null)}>取消</Button>
            <Button
              type="button"
              variant={action === 'assign_roles' ? 'default' : 'destructive'}
              disabled={busy || waitingForChoices || (!reviewQueue && !members.length)
                || (action === 'assign_roles' && !reviewQueue && !roleIds.length)}
              onClick={() => void apply()}
            >
              {busy ? '处理中…' : reviewQueue ? (reviewQueue.pending.some(member => member.review) ? '保存个人权限选择' : '重新核对') : '确认执行'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  </>
}
