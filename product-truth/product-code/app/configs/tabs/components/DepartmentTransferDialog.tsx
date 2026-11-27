'use client'

import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { buildDepartmentOptions } from '@/lib/department-spaces'
import {
  departmentOverrideChoiceRequired, type DepartmentOverrideChoice,
} from '@/lib/admin/member-department-save-contract'
import type { OrgSummaryDepartment, OrgSummaryUser } from '../../types'

const operationLabels = {
  primary: { label: '调整主部门', field: '新主部门' },
  add: { label: '添加兼岗', field: '新兼岗部门' },
  remove: { label: '移除兼岗', field: '要移除的兼岗部门' },
} as const
type Operation = keyof typeof operationLabels

interface DepartmentTransferDialogProps {
  orgId: string
  member: OrgSummaryUser
  departments: OrgSummaryDepartment[]
  authHeaders: () => HeadersInit
  onClose: () => void
  onTransferred: () => void
}

export function DepartmentTransferDialog({
  orgId, member, departments, authHeaders, onClose, onTransferred,
}: DepartmentTransferDialogProps) {
  const fieldId = useId()
  const operationId = useId()
  const directoryManaged = Boolean(member.directory_identity_id)
  const [operation, setOperation] = useState<Operation>(directoryManaged ? 'add' : 'primary')
  const [departmentId, setDepartmentId] = useState('')
  const [keepPrevious, setKeepPrevious] = useState(false)
  const [choice, setChoice] = useState<ReturnType<typeof departmentOverrideChoiceRequired.parse> | null>(null)
  const [retryChoice, setRetryChoice] = useState<DepartmentOverrideChoice>()
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [unverified, setUnverified] = useState(false)
  const submitting = useRef(false)
  const requestId = useRef<string | null>(null)
  const departmentById = new Map(departments.map(department => [department.id, department]))
  const primaryId = member.primary_dept_id ?? null
  const secondaryIds = new Set((member.department_ids ?? []).filter(id => id !== primaryId))
  const activeIds = buildDepartmentOptions(departments).map(department => department.department_id)
  const selectable = (id: string) => !directoryManaged || departmentById.get(id)?.source === 'manual'
  const removableIds = [...secondaryIds].filter(id => departmentById.has(id) && selectable(id))
  const options = operation === 'remove'
    ? removableIds
    : activeIds.filter(id => id !== primaryId && selectable(id) && (operation === 'primary' || !secondaryIds.has(id)))
  const labels = operationLabels[operation]
  const fieldsLocked = busy || choice !== null || unverified

  function departmentName(id: string | null) {
    if (!id) return '未分配'
    const path: string[] = []
    const seen = new Set<string>()
    let department = departmentById.get(id)
    while (department && !seen.has(department.id)) {
      path.unshift(department.name)
      seen.add(department.id)
      department = department.parent_id ? departmentById.get(department.parent_id) : undefined
    }
    return path.join(' / ') || (id === member.primary_dept_id && member.primary_dept_name) || '未能识别的部门'
  }

  function resetChoice() {
    requestId.current = null
    setChoice(null)
    setRetryChoice(undefined)
    setFeedback('')
  }

  function reportUnverified() {
    setUnverified(true)
    setFeedback('暂时无法确认保存结果。可重新核对本次提交。')
  }

  async function save(selectedChoice?: DepartmentOverrideChoice) {
    if (submitting.current || (directoryManaged && operation === 'primary') || !options.includes(departmentId)
      || (choice && !selectedChoice)) return

    submitting.current = true
    setBusy(true)
    setRetryChoice(selectedChoice)
    setFeedback('')
    try {
      requestId.current ??= crypto.randomUUID()
      const endpoint = operation === 'primary' ? 'department-transfer' : 'departments'
      const response = await fetch(`/api/admin/users/${encodeURIComponent(member.id)}/${endpoint}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          action: 'save', expected_org_id: orgId, department_id: departmentId, request_id: requestId.current,
          ...(operation === 'primary' ? { keep_previous: keepPrevious } : { operation }),
          ...(choice && selectedChoice ? { choice_id: choice.choice_id, override_choice: selectedChoice } : {}),
        }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) {
        if (response.status >= 500) {
          reportUnverified()
          return
        }
        setUnverified(false)
        if (result?.code === 'DEPARTMENT_TRANSFER_STALE' || result?.code === 'SECONDARY_DEPARTMENT_STALE') resetChoice()
        setFeedback(typeof result?.error === 'string' ? result.error : '部门保存失败，请重试。')
        return
      }

      const requiredChoice = departmentOverrideChoiceRequired.safeParse(result)
      if (requiredChoice.success) {
        setUnverified(false)
        setChoice(requiredChoice.data)
        setRetryChoice(undefined)
        return
      }

      const matchingSecondaryReceipt = operation !== 'primary' && result?.action === operation
        && Array.isArray(result.affected_department_ids)
      if (matchingSecondaryReceipt && result.status === 'unchanged' && result.affected_department_ids.length === 0) {
        setUnverified(false)
        resetChoice()
        setFeedback('部门关系无需变更，请刷新成员名单核对。')
        return
      }
      const saved = result?.status === 'applied' && typeof result.effective_at === 'string'
        && (operation === 'primary' ? result.department_id === departmentId
          : matchingSecondaryReceipt && result.affected_department_ids.length === 1
            && result.affected_department_ids[0] === departmentId)
      if (saved) onTransferred()
      else reportUnverified()
    } catch {
      reportUnverified()
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !submitting.current) onClose() }}>
      <DialogContent showCloseButton={!busy} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>调整部门</DialogTitle>
          <DialogDescription>{member.display_name}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-y-auto">
          <p>当前主部门　{departmentName(primaryId)}</p>
          {directoryManaged && <p className="text-sm text-muted-foreground">此处可调整 ICU 自建兼岗。</p>}
          <div className="grid gap-2">
            <label className="font-medium" htmlFor={operationId}>调整内容</label>
            <select id={operationId} className="h-9 w-full rounded-md border border-input bg-background px-3"
              value={operation} disabled={fieldsLocked} onChange={event => {
                setOperation(event.target.value as Operation)
                setDepartmentId('')
                setKeepPrevious(false)
                resetChoice()
              }}>
              {Object.entries(operationLabels).filter(([key]) => !directoryManaged || key !== 'primary').map(([key, option]) => (
                <option value={key} key={key} disabled={key === 'remove' && removableIds.length === 0}>{option.label}</option>
              ))}
            </select>
            <label className="font-medium" htmlFor={fieldId}>{labels.field}</label>
            <select id={fieldId} className="h-9 w-full rounded-md border border-input bg-background px-3"
              value={departmentId} disabled={fieldsLocked}
              onChange={event => { setDepartmentId(event.target.value); resetChoice() }}>
              <option value="">{options.length > 0 ? '请选择部门' : '暂无可选部门'}</option>
              {options.map(id => <option value={id} key={id}>{departmentName(id)}</option>)}
            </select>
          </div>
          {operation === 'primary' && primaryId && (
            <label className="flex items-center gap-2">
              <Checkbox checked={keepPrevious} disabled={fieldsLocked}
                onCheckedChange={checked => { setKeepPrevious(checked === true); resetChoice() }} />
              保留原主部门为兼岗
            </label>
          )}
          {choice && (
            <fieldset className="space-y-2 rounded-md border p-3" disabled={busy || unverified} aria-busy={busy}>
              <legend className="px-1 font-medium">调整后的个人权限</legend>
              <p className="text-sm text-muted-foreground">
                有 {choice.impact.affected_count} 项个人部门权限受影响
                {choice.impact.retainable_count > 0
                  ? `，${choice.impact.retainable_count} 项可保留。`
                  : '。原权限的数据范围已无法沿用。'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => void save('new_baseline')}>
                  {busy && !unverified && retryChoice === 'new_baseline' ? '保存中…' : '按调整后的部门权限生效'}
                </Button>
                {choice.impact.retainable_count > 0 && (
                  <Button type="button" variant="outline" onClick={() => void save('retain_eligible')}>
                    {busy && !unverified && retryChoice === 'retain_eligible' ? '保存中…' : '保留符合条件的个人权限'}
                  </Button>
                )}
              </div>
            </fieldset>
          )}
          {feedback && <p className="text-destructive" role="alert">{feedback}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
          {choice && <Button type="button" variant="outline" disabled={busy || unverified} onClick={resetChoice}>返回修改</Button>}
          {(!choice || unverified) && (
            <Button type="button" disabled={busy || !options.includes(departmentId)} onClick={() => void save(retryChoice)}>
              {busy ? '保存中…' : unverified ? '重新核对' : '保存'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
