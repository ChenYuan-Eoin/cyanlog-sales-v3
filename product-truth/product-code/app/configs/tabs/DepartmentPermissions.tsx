'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DEPARTMENT_LEDGER_VIEW } from '@/lib/shipping/department-ledger-access'
import { buildDepartmentPermissionDirectory, getDirectoryActions } from '../permission-directory'
import { PermissionSettingTable } from './PermissionSettingTable'

type DepartmentGrant = { permissions: string[]; includeSubdepartments: boolean }
type DepartmentPermissionSnapshot = DepartmentGrant & { availablePermissions: string[]; editable: boolean }
type DepartmentPermissionState = { saved: DepartmentPermissionSnapshot; draft: DepartmentGrant }
type Feedback = { kind: 'error' | 'success'; message: string }

class DepartmentPermissionRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

function isPermissionList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(key => typeof key === 'string' && key.length > 0)
    && new Set(value).size === value.length
}

function sameGrant(first: DepartmentGrant, second: DepartmentGrant) {
  return first.includeSubdepartments === second.includeSubdepartments
    && first.permissions.length === second.permissions.length
    && first.permissions.every(key => second.permissions.includes(key))
}

async function readDepartmentPermissions(
  endpoint: string, orgId: string, departmentId: string, headers: HeadersInit, signal?: AbortSignal,
): Promise<DepartmentPermissionSnapshot> {
  const response = await fetch(endpoint, { headers, cache: 'no-store', signal })
  if (!response.ok) throw new DepartmentPermissionRequestError('部门授权暂不可用，请重新读取。', response.status)

  const data = await response.json()
  if (data?.org_id !== orgId || data.department_id !== departmentId
    || !isPermissionList(data.permissions) || !isPermissionList(data.available_permissions)
    || typeof data.permissions_editable !== 'boolean' || typeof data.include_subdepartments !== 'boolean') {
    throw new Error('无法核对当前组织和部门的授权，请重新读取。')
  }

  return {
    permissions: data.permissions,
    includeSubdepartments: data.include_subdepartments,
    availablePermissions: data.available_permissions,
    editable: data.permissions_editable,
  }
}

export function DepartmentPermissions({ orgId, departmentId, authHeaders }: {
  orgId: string
  departmentId: string
  authHeaders: (includeJson?: boolean) => HeadersInit
}) {
  const endpoint = `/api/admin/departments/${encodeURIComponent(departmentId)}/permissions`
  const [state, setState] = useState<DepartmentPermissionState | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState(false)
  const [readVersion, setReadVersion] = useState(0)
  const savingRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    void readDepartmentPermissions(endpoint, orgId, departmentId, authHeaders(), controller.signal)
      .then(saved => {
        if (!controller.signal.aborted) setState({ saved, draft: saved })
      })
      .catch(error => {
        if (controller.signal.aborted) return
        setState(null)
        if (error instanceof DepartmentPermissionRequestError && (error.status === 401 || error.status === 403)) return
        setFeedback({ kind: 'error', message: error instanceof Error ? error.message : '部门授权暂不可用，请重新读取。' })
      })
    return () => controller.abort()
  }, [authHeaders, departmentId, endpoint, orgId, readVersion])

  if (!state && !feedback) return null

  const available = new Set(state?.saved.availablePermissions)
  const groups = buildDepartmentPermissionDirectory(available)
  const displayedKeys = new Set(groups.flatMap(getDirectoryActions).map(action => action.key))
  const unavailableKeys = state?.draft.permissions.filter(key => !available.has(key)) ?? []
  const editable = state?.saved.editable === true
  const canSave = editable && state && unavailableKeys.length === 0 && !sameGrant(state.saved, state.draft)
  const ledgerEntry = available.has(DEPARTMENT_LEDGER_VIEW) && state?.draft.permissions.includes(DEPARTMENT_LEDGER_VIEW) === true

  function changePermissions(keys: string[], enabled?: boolean) {
    if (!editable || busy) return
    setFeedback(null)
    setState(current => {
      if (!current) return current
      const permissions = new Set(current.draft.permissions)
      for (const key of keys) {
        if (enabled ?? !permissions.has(key)) {
          if (displayedKeys.has(key)) permissions.add(key)
        } else if (displayedKeys.has(key) || !available.has(key)) {
          permissions.delete(key)
        }
      }
      return { ...current, draft: {
        permissions: [...permissions], includeSubdepartments: permissions.size > 0 && current.draft.includeSubdepartments,
      } }
    })
  }

  function reload() {
    setFeedback(null)
    setState(null)
    setReadVersion(version => version + 1)
  }

  async function save() {
    if (!state || !canSave || savingRef.current) return
    savingRef.current = true
    setBusy(true)
    setFeedback(null)
    const { saved, draft } = state
    const headers = authHeaders(true)
    let awaitingReadback = true

    try {
      const response = await fetch(endpoint, {
        method: 'PATCH', headers,
        body: JSON.stringify({
          expected_org_id: orgId,
          expected_permissions: saved.permissions,
          expected_include_subdepartments: saved.includeSubdepartments,
          permissions: draft.permissions,
          include_subdepartments: draft.includeSubdepartments,
        }),
      })
      const conflict = response.status === 409
      if (!response.ok && !conflict) {
        awaitingReadback = response.status >= 500
        const data = await response.json().catch(() => null)
        throw new DepartmentPermissionRequestError(
          typeof data?.error === 'string' ? data.error : '部门授权保存失败，请重试。', response.status,
        )
      }

      const confirmed = await readDepartmentPermissions(endpoint, orgId, departmentId, headers)
      setState({ saved: confirmed, draft: confirmed })
      setFeedback(conflict ? { kind: 'error', message: '部门授权已更新，请核对后重新操作。' } : sameGrant(confirmed, draft)
        ? { kind: 'success', message: '部门授权已保存。' }
        : { kind: 'error', message: '回读的部门授权与本次保存不一致，请核对当前授权。' })
    } catch (error) {
      if (awaitingReadback || (error instanceof DepartmentPermissionRequestError && (error.status === 401 || error.status === 403))) {
        setState(null)
      }
      setFeedback({ kind: 'error', message: awaitingReadback ? '未能确认保存结果，请重新读取部门授权。'
        : error instanceof Error ? error.message : '部门授权保存失败，请重试。' })
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  return (
    <details className="rounded-lg border bg-white">
      <summary className="cursor-pointer px-6 py-4 font-medium text-slate-900">部门权限设置</summary>
      {state && <>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={state.draft.includeSubdepartments}
              disabled={!editable || busy || state.draft.permissions.length === 0 || unavailableKeys.length > 0}
              onChange={event => {
                const includeSubdepartments = event.target.checked
                setFeedback(null)
                setState(current => current && ({ ...current, draft: { ...current.draft, includeSubdepartments } }))
              }} />
            授权范围包含下级部门
          </label>
          {editable && (groups.length > 0 || state.saved.permissions.length > 0) && (
            <Button type="button" size="sm" onClick={() => void save()} disabled={!canSave || busy}>
              {busy ? '正在核对授权…' : '保存部门授权'}
            </Button>
          )}
        </div>
        {unavailableKeys.length > 0 && editable && (
          <div className="flex flex-wrap items-center gap-3 border-t px-6 py-3 text-sm text-slate-600">
            <p>部分已有授权当前不可用。</p>
            <Button type="button" size="sm" variant="outline" disabled={busy}
              onClick={() => changePermissions(unavailableKeys, false)}>撤销不可用授权</Button>
          </div>
        )}
        <PermissionSettingTable
          description="设置当前部门的明确数据授权。"
          perms={state.draft.permissions}
          ownerPerms={[]}
          groups={groups}
          availableModuleKeys={available}
          entryStates={{ shipping: { checked: ledgerEntry, canClear: ledgerEntry && editable && !busy } }}
          isSuperAdmin={false}
          readOnly={!editable || busy || groups.length === 0}
          ownerReadOnly
          blockReason={!state.saved.editable ? '当前账号仅可查看部门授权。'
            : groups.length === 0 ? '当前没有可配置的部门权限。' : null}
          onToggle={key => changePermissions([key])}
          onSetGroup={changePermissions}
          onClearEntry={entry => { if (entry === 'shipping') changePermissions([DEPARTMENT_LEDGER_VIEW], false) }}
        />
      </>}
      {feedback && (
        <div className="flex flex-wrap items-center gap-3 px-6 pb-4 text-sm">
          <p role={feedback.kind === 'error' ? 'alert' : 'status'}
            className={feedback.kind === 'error' ? 'text-red-700' : 'text-green-700'}>{feedback.message}</p>
          {!state && <Button type="button" size="sm" variant="outline" onClick={reload}>重新读取</Button>}
        </div>
      )}
    </details>
  )
}
