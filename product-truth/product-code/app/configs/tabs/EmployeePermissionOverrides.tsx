'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { parseModuleCatalog } from '@/lib/org-role-permission-readback'
import { BUILTIN_PERMISSION_BY_KEY } from '@/lib/permission-catalog'
import { buildRolePermissionDirectory, getDirectoryActions } from '../permission-directory'
import type { OrgSummaryUser } from '../types'
import {
  PermissionSettingTable, sameEmployeeOverride, type EmployeePermissionOverride, type EmployeePermissionState,
} from './PermissionSettingTable'

const departmentRange = z.object({ department_id: z.string(), include_subdepartments: z.boolean() })
const scope = z.discriminatedUnion('type', [
  z.object({ type: z.literal('self') }),
  z.object({ type: z.literal('org') }),
  z.object({ type: z.literal('department'), departments: z.array(departmentRange) }),
])
const overrideSchema = z.discriminatedUnion('effect', [
  z.object({ effect: z.literal('DENY'), scope: z.null() }),
  z.object({ effect: z.literal('ALLOW'), scope }),
]).nullable()
const snapshotSchema = z.object({
  org_id: z.string(),
  user_id: z.string(),
  target_revision: z.string().min(1).max(128).optional(),
  permissions: z.array(z.object({
    key: z.string(), base: z.boolean(), effective: z.boolean(),
    base_scope: scope.nullable(), effective_scope: scope.nullable(), override: overrideSchema,
    sources: z.array(z.object({ kind: z.enum(['role', 'department']), name: z.string() })),
    can_edit: z.boolean(),
    scope_types: z.array(z.enum(['self', 'org', 'department'])).optional(),
  })),
  departments: z.array(z.object({ id: z.string(), name: z.string(), parent_id: z.string().nullable() })),
  shipping_permission_publication: z.object({ registered: z.array(z.string()), published: z.array(z.string()) }),
  organization_permission_publication: z.array(z.string()).optional(),
  permission_catalog: z.array(z.unknown()).optional(),
})
type Snapshot = z.infer<typeof snapshotSchema>

const transferReviewSchema = z.object({
  items: z.array(z.object({
    review_id: z.string().min(1),
    kind: z.enum(['role', 'retained_role', 'personal_override', 'pending_role', 'department_lead', 'space_membership']),
    effective_at: z.string(),
    permission_code: z.string().nullish(),
    effect: z.enum(['ALLOW', 'DENY']).nullish(),
    role_name: z.string().nullish(),
    scope_type: z.string().nullish(),
    department_name: z.string().nullish(),
    space_name: z.string().nullish(),
  })),
  has_more: z.boolean(),
})
type TransferReviewResult = z.infer<typeof transferReviewSchema>
type TransferReviewItem = TransferReviewResult['items'][number]

export function isEmployeePermissionTarget(user: OrgSummaryUser) {
  return (user.directory_pending_account === true && user.status === 'inactive'
    && user.membership_status === 'invited' && user.can_preassign_org_roles === true)
    || (user.status === 'active' && user.login_enabled !== false && user.directory_pending_account !== true
      && (!user.membership_status || user.membership_status === 'active')
      && (!user.employment_status || user.employment_status === 'active'))
}

function getHeaders(token: string | null) {
  return token ? { Authorization: 'Bearer ' + token } : undefined
}

function employeePermissionEndpoint(orgId: string, userId: string) {
  return '/api/admin/users/' + encodeURIComponent(userId) + '/permission-overrides?orgId=' + encodeURIComponent(orgId)
}

async function readSnapshot(response: Response, orgId: string, userId: string): Promise<Snapshot> {
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : '无法读取员工权限。')
  const parsed = snapshotSchema.safeParse(result)
  if (!parsed.success || parsed.data.org_id !== orgId || parsed.data.user_id !== userId) {
    throw new Error('接口返回的组织或员工无法核对，请重新读取。')
  }
  return parsed.data
}

export async function readEmployeePermissionOverrideCount(orgId: string, userId: string, signal: AbortSignal) {
  const token = localStorage.getItem('token')
  const response = await fetch(employeePermissionEndpoint(orgId, userId), {
    headers: getHeaders(token), cache: 'no-store', signal,
  })
  const snapshot = await readSnapshot(response, orgId, userId)
  if (token !== localStorage.getItem('token')) throw new Error('登录身份已变更，请重新读取。')
  return snapshot.permissions.filter(permission => permission.override !== null).length
}

export function EmployeePermissionReview({ orgId, userId, change = '角色分配' }: {
  orgId: string
  userId: string
  change?: '角色分配' | '主部门'
}) {
  const [review, setReview] = useState<{ orgId: string; userId: string; count: number | null }>()
  useEffect(() => {
    const controller = new AbortController()
    function finish(count: number | null) {
      if (!controller.signal.aborted) setReview({ orgId, userId, count })
    }
    void readEmployeePermissionOverrideCount(orgId, userId, controller.signal).then(finish, () => finish(null))
    return () => controller.abort()
  }, [orgId, userId])
  if (review?.orgId !== orgId || review.userId !== userId || review.count === 0) return null
  return review.count === null ? (
    <p role="status" className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
      暂时无法核对该员工的个人权限设置。
    </p>
  ) : (
    <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      此员工有 {review.count} 项个人权限设置。保存{change}后，个人设置仍覆盖对应权限点及数据范围。
    </p>
  )
}

function DepartmentTransferReviews({
  orgId, userId, permissions, permissionName, editorId, onOpenEditor,
}: {
  orgId: string
  userId: string
  permissions: ReadonlyMap<string, EmployeePermissionState>
  permissionName: (code: string) => string
  editorId: string
  onOpenEditor: () => void
}) {
  const sectionId = useId()
  const endpoint = '/api/admin/users/' + encodeURIComponent(userId) + '/department-transfer-review'
  const [result, setResult] = useState<TransferReviewResult>({ items: [], has_more: false })
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const readRequest = useRef<{ controller: AbortController; token: string | null } | null>(null)
  const submitting = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    const token = localStorage.getItem('token')
    readRequest.current = { controller, token }

    async function read() {
      try {
        const response = await fetch(endpoint + '?expected_org_id=' + encodeURIComponent(orgId), {
          headers: getHeaders(token), signal: controller.signal, cache: 'no-store',
        })
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          if (!controller.signal.aborted) setResult({ items: [], has_more: false })
          return
        }
        if (!response.ok) throw new Error()
        const items = transferReviewSchema.parse(await response.json())
        if (!controller.signal.aborted && token === localStorage.getItem('token')) setResult(items)
      } catch {
        if (!controller.signal.aborted) setFeedback('暂时无法读取调部门复核事项。')
      }
    }
    void read()
    return () => controller.abort()
  }, [attempt, endpoint, orgId])

  async function acknowledge(item: TransferReviewItem) {
    const request = readRequest.current
    if (!request || request.controller.signal.aborted || selected !== item.review_id || submitting.current) return
    if (request.token !== localStorage.getItem('token')) {
      setResult({ items: [], has_more: false })
      setFeedback('登录身份已变更，请重新打开员工权限。')
      return
    }
    submitting.current = true
    setBusy(true)
    setFeedback('')
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { ...getHeaders(request.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_org_id: orgId, review_id: item.review_id }),
        signal: request.controller.signal,
      })
      const receipt = await response.json().catch(() => null)
      if (request.controller.signal.aborted) return
      if (!response.ok || receipt?.success !== true || receipt.review_id !== item.review_id) {
        throw new Error(typeof receipt?.error === 'string' ? receipt.error : '未能确认复核结果，请重试。')
      }
      setResult(current => ({ ...current, items: current.items.filter(row => row.review_id !== item.review_id) }))
      setSelected(null)
      setFeedback('已记录复核结果。')
      if (result.has_more) setAttempt(count => count + 1)
    } catch (error) {
      if (!request.controller.signal.aborted) setFeedback(error instanceof Error ? error.message : '暂时无法提交复核。')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  function reviewLabel(item: TransferReviewItem) {
    if (item.kind === 'personal_override') return item.permission_code ? permissionName(item.permission_code) : '个人权限'
    if (item.kind === 'department_lead') return item.department_name ? item.department_name + '负责人范围' : '部门负责人范围'
    if (item.kind === 'space_membership') return item.space_name || '历史空间'
    return item.role_name || '已归档角色'
  }

  return <>
    {result.items.length > 0 && (
      <section aria-labelledby={sectionId} className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={sectionId} className="font-medium text-slate-900">调部门待复核</h3>
          <a href={'#' + editorId} onClick={event => { event.preventDefault(); onOpenEditor() }}
            className="text-sm text-blue-700 underline underline-offset-2">打开当前权限表</a>
        </div>
        <ul className="divide-y divide-amber-100">
          {result.items.map(item => {
            const label = reviewLabel(item)
            const current = item.permission_code ? permissions.get(item.permission_code) : undefined
            const scopeLabel = item.kind === 'department_lead' ? null : item.department_name
              || (item.scope_type === 'org' ? '组织级' : null)
            const disposition = item.kind === 'retained_role' ? '调岗时保留'
              : item.kind === 'personal_override' && item.effect === 'DENY' ? '调岗时保留关闭'
                : item.kind === 'pending_role' ? '调岗时暂停首次登录授权' : '调岗时暂停授权'
            return <li key={item.review_id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-medium">{label}</span>
                  {scopeLabel && <span className="ml-2 text-xs text-slate-600">{scopeLabel}</span>}
                  <p className="text-xs text-slate-600">
                    {disposition}{current && (current.effective ? ' · 当前开启' : ' · 当前关闭')}
                    {' · '}<time dateTime={item.effective_at}>{new Date(item.effective_at).toLocaleString('zh-CN', { hour12: false })}</time>
                  </p>
                </div>
                {selected !== item.review_id && (
                  <Button type="button" size="sm" variant="outline" disabled={busy}
                    aria-label={label + ' 标为已复核'}
                    onClick={() => { setSelected(item.review_id); setFeedback('') }}>标为已复核</Button>
                )}
              </div>
              {selected === item.review_id && <div role="group" aria-label={'确认复核 ' + label}
                className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-amber-100 pt-2">
                <p className="text-sm text-slate-700">只记录复核结果。如需授权，请在当前权限表重新配置。</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>取消</Button>
                  <Button type="button" size="sm" disabled={busy} onClick={() => void acknowledge(item)}>
                    {busy ? '提交中…' : '确认已复核'}
                  </Button>
                </div>
              </div>}
            </li>
          })}
        </ul>
        {result.has_more && <p className="text-xs text-slate-600">还有待复核事项，处理后继续显示。</p>}
      </section>
    )}
    {feedback && <p role="status" className="text-sm text-slate-600">{feedback}</p>}
  </>
}

export function EmployeePermissionOverrides({ orgId, userId, userName, onClose }: {
  orgId: string
  userId: string
  userName: string
  onClose: () => void
}) {
  const endpoint = employeePermissionEndpoint(orgId, userId)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reloadRequired, setReloadRequired] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const requests = useRef<AbortController | null>(null)
  const editorId = useId()
  const editor = useRef<HTMLElement | null>(null)
  const snapshotToken = useRef<string | null>(null)
  const pendingWrite = useRef(false)
  const employee = useMemo(() => {
    if (!snapshot) return null
    const registered = new Set(snapshot.shipping_permission_publication.registered)
    const published = new Set([
      ...snapshot.shipping_permission_publication.published.filter(key => registered.has(key)),
      ...(snapshot.organization_permission_publication ?? []),
    ])
    const groups = buildRolePermissionDirectory(parseModuleCatalog(snapshot.permission_catalog))
    return {
      permissions: new Map(snapshot.permissions.map(item => [item.key, item])),
      departments: snapshot.departments,
      published,
      groups,
      permissionLabels: new Map(groups.flatMap(getDirectoryActions).map(action => [action.key, action.label])),
    }
  }, [snapshot])

  useEffect(() => {
    const controller = new AbortController()
    requests.current = controller
    const token = localStorage.getItem('token')
    setLoading(true)
    setFeedback(null)
    async function read() {
      try {
        const state = await readSnapshot(await fetch(endpoint, {
          headers: getHeaders(token), signal: controller.signal, cache: 'no-store',
        }), orgId, userId)
        if (controller.signal.aborted) return
        if (token !== localStorage.getItem('token')) throw new Error('登录身份已变更，请重新读取。')
        snapshotToken.current = token
        setSnapshot(state)
        setReloadRequired(false)
      } catch (error) {
        if (controller.signal.aborted) return
        setSnapshot(null)
        setFeedback({ kind: 'error', text: error instanceof Error ? error.message : '无法读取员工权限。' })
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void read()
    return () => controller.abort()
  }, [attempt, endpoint, orgId, userId])

  async function save(state: EmployeePermissionState, override: EmployeePermissionOverride) {
    const controller = requests.current
    if (!controller || controller.signal.aborted || reloadRequired || pendingWrite.current || !state.can_edit) return
    const token = localStorage.getItem('token')
    if (token !== snapshotToken.current) {
      setSnapshot(null)
      setFeedback({ kind: 'error', text: '登录身份已变更，请重新读取。' })
      return
    }
    pendingWrite.current = true
    setSaving(true)
    setReloadRequired(true)
    setFeedback(null)
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { ...getHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_code: state.key, expected_override: state.override, override, target_revision: snapshot?.target_revision }),
        signal: controller.signal,
      })
      if (response.status === 400) setReloadRequired(false)
      if (response.status === 401 || response.status === 403) setSnapshot(null)
      if (response.status === 409) throw new Error('权限或当前组织已变更。请重新读取后再提交。')
      const written = await readSnapshot(response, orgId, userId)
      const readback = await readSnapshot(await fetch(endpoint, {
        headers: getHeaders(token), signal: controller.signal, cache: 'no-store',
      }), orgId, userId)
      if (controller.signal.aborted) return
      const receipt = written.permissions.find(item => item.key === state.key)
      const verified = readback.permissions.find(item => item.key === state.key)
      if (token !== localStorage.getItem('token') || !receipt || !verified || !sameEmployeeOverride(receipt.override, override)
        || !sameEmployeeOverride(verified.override, override) || (readback.target_revision !== snapshot?.target_revision)) {
        throw new Error('未能核对已保存的权限，请重新读取后确认。')
      }
      setSnapshot(readback)
      setReloadRequired(false)
      setFeedback({ kind: 'success', text: override ? '已保存该权限点的个人设置。' : '已恢复为当前部门和角色授权。' })
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ kind: 'error', text: error instanceof Error ? error.message : '无法保存员工权限。' })
    } finally {
      pendingWrite.current = false
      if (!controller.signal.aborted) setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>员工权限设置 · {userName}</DialogTitle>
          <DialogDescription>员工的基础权限来自部门和角色。个人设置将覆盖该权限点的开关和数据范围。</DialogDescription>
        </DialogHeader>
        {snapshot?.target_revision && <p role="status" className="text-sm text-slate-600">待首次登录生效</p>}
        {loading && <p role="status" className="text-sm text-slate-600">正在读取员工权限…</p>}
        {saving && <p role="status" className="text-sm text-slate-600">正在保存并核对权限…</p>}
        {feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={feedback.kind === 'error' ? 'text-sm text-red-700' : 'text-sm text-green-700'}>{feedback.text}</p>}
        {!loading && (!employee || reloadRequired) && <div>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setAttempt(count => count + 1)}>
            重新读取员工权限
          </Button>
        </div>}
        {!loading && employee && <>
          <DepartmentTransferReviews key={JSON.stringify([orgId, userId])}
            orgId={orgId} userId={userId} permissions={employee.permissions}
            permissionName={code => employee.permissionLabels.get(code) ?? BUILTIN_PERMISSION_BY_KEY.get(code)?.label ?? code}
            editorId={editorId} onOpenEditor={() => editor.current?.focus()} />
          <section id={editorId} ref={editor} tabIndex={-1} aria-label="当前权限表">
            <PermissionSettingTable
              groups={employee.groups}
              description="选择「恢复基础授权」并保存可清除该项个人设置。"
              employee={{ ...employee, disabled: saving || reloadRequired, onChange: save }}
            />
          </section>
        </>}
      </DialogContent>
    </Dialog>
  )
}
