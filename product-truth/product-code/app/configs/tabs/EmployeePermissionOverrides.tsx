'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { parseModuleCatalog } from '@/lib/org-role-permission-readback'
import { buildRolePermissionDirectory } from '../permission-directory'
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
  permissions: z.array(z.object({
    key: z.string(), base: z.boolean(), effective: z.boolean(),
    base_scope: scope.nullable(), effective_scope: scope.nullable(), override: overrideSchema,
    sources: z.array(z.object({ kind: z.enum(['role', 'department']), name: z.string() })),
    can_edit: z.boolean(),
  })),
  departments: z.array(z.object({ id: z.string(), name: z.string(), parent_id: z.string().nullable() })),
  shipping_permission_publication: z.object({ registered: z.array(z.string()), published: z.array(z.string()) }),
  permission_catalog: z.array(z.unknown()).optional(),
})
type Snapshot = z.infer<typeof snapshotSchema>

export function isEmployeePermissionTarget(user: OrgSummaryUser) {
  return user.status === 'active' && user.login_enabled !== false && user.directory_pending_account !== true
    && (!user.membership_status || user.membership_status === 'active')
    && (!user.employment_status || user.employment_status === 'active')
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
      暂时无法核对该员工的寄件个人设置。
    </p>
  ) : (
    <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      此员工有 {review.count} 项寄件个人设置。保存{change}后，个人设置仍覆盖对应权限点及数据范围。
    </p>
  )
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
  const snapshotToken = useRef<string | null>(null)
  const pendingWrite = useRef(false)
  const employee = useMemo(() => {
    if (!snapshot) return null
    const registered = new Set(snapshot.shipping_permission_publication.registered)
    const published = new Set(snapshot.shipping_permission_publication.published.filter(key => registered.has(key)))
    return {
      permissions: new Map(snapshot.permissions.map(item => [item.key, item])),
      departments: snapshot.departments,
      published,
      groups: buildRolePermissionDirectory(parseModuleCatalog(snapshot.permission_catalog)),
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
        body: JSON.stringify({ permission_code: state.key, expected_override: state.override, override }),
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
        || !sameEmployeeOverride(verified.override, override)) {
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
        {loading && <p role="status" className="text-sm text-slate-600">正在读取员工权限…</p>}
        {saving && <p role="status" className="text-sm text-slate-600">正在保存并核对权限…</p>}
        {feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={feedback.kind === 'error' ? 'text-sm text-red-700' : 'text-sm text-green-700'}>{feedback.text}</p>}
        {!loading && (!employee || reloadRequired) && <div>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setAttempt(count => count + 1)}>
            重新读取员工权限
          </Button>
        </div>}
        {!loading && employee && <PermissionSettingTable
          groups={employee.groups}
          description="选择「沿用」并保存可清除个人设置，恢复当前部门和角色计算出的权限。"
          employee={{ ...employee, disabled: saving || reloadRequired, onChange: save }}
        />}
      </DialogContent>
    </Dialog>
  )
}
