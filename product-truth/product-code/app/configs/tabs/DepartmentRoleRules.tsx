'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { BUILTIN_PERMISSION_BY_KEY } from '@/lib/permission-catalog'

const roleId = z.string().min(1)
const ruleSchema = z.object({ role_id: roleId, role_name: z.string().min(1), include_subdepartments: z.boolean() })
const roleSchema = z.object({ role_id: roleId, role_name: z.string().min(1), permissions: z.array(z.string()) })
const settingsSchema = z.object({
  org_id: z.string(),
  department_id: z.string(),
  rules: z.array(ruleSchema),
  available_roles: z.array(roleSchema),
})
const previewSchema = z.object({
  preview_id: z.string().min(1),
  expires_at: z.string().min(1),
  added_sources: z.number().int().nonnegative(),
  removed_sources: z.number().int().nonnegative(),
  affected_members: z.number().int().nonnegative(),
})

type Rule = z.infer<typeof ruleSchema>
type Settings = z.infer<typeof settingsSchema>
type Preview = z.infer<typeof previewSchema>
type EditorState = { saved: Settings; draft: Rule[] }
type Confirmation = { step: 'review' | 'confirm'; preview: Preview }
type Feedback = { kind: 'success' | 'error'; message: string }

interface DepartmentRoleRulesProps {
  orgId: string
  departmentId: string
  authHeaders: (includeJson?: boolean) => HeadersInit
  onSaved?: () => void | Promise<void>
}

function sameRules(first: Rule[], second: Rule[]) {
  const byId = new Map(second.map(rule => [rule.role_id, rule.include_subdepartments]))
  return first.length === second.length
    && first.every(rule => byId.get(rule.role_id) === rule.include_subdepartments)
}

function getSettings(value: unknown, orgId: string, departmentId: string): Settings | null {
  const result = settingsSchema.safeParse(value)
  if (!result.success || result.data.org_id !== orgId || result.data.department_id !== departmentId) return null
  const { rules, available_roles: availableRoles } = result.data
  if (new Set(rules.map(rule => rule.role_id)).size !== rules.length
    || new Set(availableRoles.map(role => role.role_id)).size !== availableRoles.length) return null
  return result.data
}

function formatRange(rule: Rule | undefined) {
  if (!rule) return '无规则'
  return rule.include_subdepartments ? '本部门及下级部门成员' : '仅本部门成员'
}

export function DepartmentRoleRules(props: DepartmentRoleRulesProps) {
  const [opened, setOpened] = useState(false)
  return (
    <details className="border-t px-6 py-4" onToggle={event => {
      if (event.currentTarget.open) setOpened(true)
    }}>
      <summary className="cursor-pointer font-medium text-slate-900">部门自动角色</summary>
      {opened && <DepartmentRoleRulesEditor {...props} />}
    </details>
  )
}

function DepartmentRoleRulesEditor({ orgId, departmentId, authHeaders, onSaved }: DepartmentRoleRulesProps) {
  const endpoint = `/api/admin/departments/${encodeURIComponent(departmentId)}/role-rules`
  const readUrl = `${endpoint}?expected_org_id=${encodeURIComponent(orgId)}`
  const roleSelectId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const submitting = useRef(false)
  const [state, setState] = useState<EditorState | null>(null)
  const [readVersion, setReadVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState(false)
  const [roleSelection, setRoleSelection] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(readUrl, { headers: authHeaders(), cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('暂时无法读取部门自动角色。')
        const saved = getSettings(await response.json(), orgId, departmentId)
        if (!saved) throw new Error('未能核对当前部门的角色规则，请重新读取。')
        if (!controller.signal.aborted) setState({ saved, draft: saved.rules })
      } catch (error) {
        if (!controller.signal.aborted) setFeedback({ kind: 'error', message: error instanceof Error
          ? error.message : '暂时无法读取部门自动角色。' })
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [authHeaders, departmentId, orgId, readUrl, readVersion])

  useEffect(() => {
    if (confirmation) headingRef.current?.focus()
  }, [confirmation])

  const availableRoles = state?.saved.available_roles.filter(role => !state.draft.some(rule => rule.role_id === role.role_id)) ?? []
  const selectedRole = availableRoles.find(role => role.role_id === roleSelection)
  const hasChanges = state !== null && !sameRules(state.saved.rules, state.draft)
  const rolesById = new Map(state?.saved.available_roles.map(role => [role.role_id, role]))
  const savedById = new Map(state?.saved.rules.map(rule => [rule.role_id, rule]))
  const draftById = new Map(state?.draft.map(rule => [rule.role_id, rule]))
  const changedIds = [...new Set([...savedById.keys(), ...draftById.keys()])].filter(id => {
    const before = savedById.get(id)
    const after = draftById.get(id)
    return before?.include_subdepartments !== after?.include_subdepartments
  })

  function reload(message?: string) {
    setState(null)
    setConfirmation(null)
    setRoleSelection('')
    setFeedback(message ? { kind: 'error', message } : null)
    setLoading(true)
    setReadVersion(version => version + 1)
  }

  function updateDraft(update: (rules: Rule[]) => Rule[]) {
    setFeedback(null)
    setState(current => current && { ...current, draft: update(current.draft) })
  }

  async function submit(action: 'preview' | 'confirm') {
    if (submitting.current || !state || !hasChanges || (action === 'confirm' && confirmation?.step !== 'confirm')) return
    const body = action === 'preview'
      ? { action, expected_org_id: orgId, rules: state.draft.map(({ role_id, include_subdepartments }) => ({ role_id, include_subdepartments })) }
      : { action, expected_org_id: orgId, preview_id: confirmation?.preview.preview_id }
    submitting.current = true
    setBusy(true)
    setFeedback(null)
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) })
      const result = await response.json().catch(() => null)
      if (response.status === 409) {
        reload('规则或成员范围已变化，请核对后重新预览。')
        return
      }
      if (response.status === 401 || response.status === 403 || (action === 'confirm' && response.status >= 500)) {
        reload('未能确认规则保存结果，请重新核对。')
        return
      }
      if (!response.ok) {
        setFeedback({ kind: 'error', message: typeof result?.error === 'string' ? result.error : '暂时无法处理部门角色规则。' })
        return
      }
      if (action === 'preview') {
        const preview = previewSchema.safeParse(result)
        if (!preview.success) throw new Error('未能读取本次规则变更的影响，请重新预览。')
        setConfirmation({ step: 'review', preview: preview.data })
        return
      }
      const saved = getSettings(result, orgId, departmentId)
      if (!saved || !sameRules(saved.rules, state.draft)) {
        reload('回读的规则与本次确认不一致，请核对当前规则。')
        return
      }
      setState({ saved, draft: saved.rules })
      setConfirmation(null)
      setFeedback({ kind: 'success', message: '部门自动角色已保存。' })
      try {
        await onSaved?.()
      } catch {
        setFeedback({ kind: 'error', message: '规则已保存，成员名单暂时无法刷新。' })
      }
    } catch (error) {
      if (action === 'confirm') reload('未能确认规则保存结果，请重新核对。')
      else setFeedback({ kind: 'error', message: error instanceof Error ? error.message : '暂时无法预览部门角色规则。' })
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 space-y-3 text-sm">
      {loading && <p role="status">正在读取部门角色规则…</p>}
      {state && (
        <>
          <p className="text-slate-600">勾选下级时，规则也匹配下级部门的成员。权限范围从匹配的实际主部门或兼岗部门计算。</p>
          {state.draft.length > 0 ? (
            <ul aria-label="当前自动角色规则" className="divide-y rounded-md border">
              {state.draft.map(rule => (
                <li key={rule.role_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="font-medium">{rule.role_name}</div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={rule.include_subdepartments} disabled={busy || !rolesById.has(rule.role_id)}
                        aria-label={`${rule.role_name} 匹配下级部门成员`}
                        onChange={event => {
                          const enabled = event.target.checked
                          updateDraft(rules => rules.map(item => item.role_id === rule.role_id
                            ? { ...item, include_subdepartments: enabled } : item))
                        }} />
                      匹配下级部门成员
                    </label>
                    <Button type="button" size="sm" variant="outline" disabled={busy}
                      aria-label={`移除 ${rule.role_name} 规则`}
                      onClick={() => updateDraft(rules => rules.filter(item => item.role_id !== rule.role_id))}>移除</Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-slate-600">尚未设置自动角色。</p>}
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid min-w-48 gap-1">
              <label htmlFor={roleSelectId}>选择角色</label>
              <select id={roleSelectId} value={roleSelection} disabled={busy || !availableRoles.length}
                onChange={event => setRoleSelection(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3">
                <option value="">{availableRoles.length > 0 ? '请选择角色' : '暂无可选择的角色'}</option>
                {availableRoles.map(role => <option key={role.role_id} value={role.role_id}>{role.role_name}</option>)}
              </select>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={busy || !selectedRole} onClick={() => {
              if (!selectedRole) return
              updateDraft(rules => [...rules, {
                role_id: selectedRole.role_id, role_name: selectedRole.role_name, include_subdepartments: false,
              }])
              setRoleSelection('')
            }}>添加角色</Button>
            <Button type="button" size="sm" disabled={busy || !hasChanges} onClick={() => void submit('preview')}>
              {busy && !confirmation ? '正在核对…' : '查看规则变更'}
            </Button>
          </div>
        </>
      )}
      {feedback && !confirmation && <p role={feedback.kind === 'error' ? 'alert' : 'status'}
        className={feedback.kind === 'error' ? 'text-destructive' : 'text-green-700'}>{feedback.message}</p>}
      {!state && !loading && <Button type="button" size="sm" variant="outline" onClick={() => reload()}>重新读取角色规则</Button>}
      {confirmation && (
        <Dialog open onOpenChange={open => { if (!open && !busy) setConfirmation(null) }}>
          <DialogContent showCloseButton={!busy} className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle ref={headingRef} tabIndex={-1} className="outline-none">
                {confirmation.step === 'review' ? '预览部门自动角色变更' : '再次确认部门自动角色变更'}
              </DialogTitle>
              <DialogDescription>
                涉及 {confirmation.preview.affected_members} 名成员，新增角色来源 {confirmation.preview.added_sources} 项，
                结束角色来源 {confirmation.preview.removed_sources} 项。
              </DialogDescription>
            </DialogHeader>
            <ul aria-label="部门自动角色变更" className="max-h-72 list-disc space-y-2 overflow-y-auto pl-4 text-sm">
              {changedIds.map(id => {
                const before = savedById.get(id)
                const after = draftById.get(id)
                const permissions = rolesById.get(id)?.permissions ?? []
                return <li key={id}>
                  <p className="font-medium">{after?.role_name ?? before?.role_name}</p>
                  <p>{formatRange(before)} → {formatRange(after)}</p>
                  {after && permissions.length > 0 && <p className="text-slate-600">
                    角色权限 {permissions.map(key => BUILTIN_PERMISSION_BY_KEY.get(key)?.label ?? key).join('、')}
                  </p>}
                </li>
              })}
            </ul>
            {feedback?.kind === 'error' && <p role="alert" className="text-destructive">{feedback.message}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmation(null)}>取消</Button>
              {confirmation.step === 'review' ? (
                <Button type="button" key="review" onClick={() => setConfirmation({ ...confirmation, step: 'confirm' })}>继续确认</Button>
              ) : (
                <>
                  <Button type="button" variant="outline" disabled={busy}
                    onClick={() => setConfirmation({ ...confirmation, step: 'review' })}>返回预览</Button>
                  <Button type="button" key="confirm" variant="destructive" disabled={busy} onClick={() => void submit('confirm')}>
                    {busy ? '提交中…' : '确认变更'}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
