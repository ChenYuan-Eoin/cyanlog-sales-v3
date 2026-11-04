'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ConnectionSummary, ProviderCapability } from '@/lib/organization-connections/types'
import type { DirectoryInspection } from '@/lib/organization-connections/directory-inspection'

function headers(json = false): HeadersInit {
  let token: string | null = null
  try { token = window.localStorage.getItem('token') } catch { /* cookie authentication remains available */ }
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) }
}

function statusLabel(status: string) {
  return ({ active: '启用／在职', inactive: '停用／离职', deleted: '已删除' } as Record<string, string>)[status] || '状态待核对'
}

export function DirectoryInspectionPanel({ provider }: { provider: ProviderCapability }) {
  const [connection, setConnection] = useState<ConnectionSummary | null>(null)
  const [report, setReport] = useState<DirectoryInspection | null>(null)
  const [failure, setFailure] = useState('')
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState(false)
  const request = useRef<AbortController | null>(null)
  const inFlight = useRef(false)

  const loadConnection = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/admin/organization-sources/connection?provider=${encodeURIComponent(provider.key)}`, {
      headers: headers(), cache: 'no-store', signal,
    })
    const body = await response.json().catch(() => ({})) as { data?: { connection?: ConnectionSummary }; error?: string }
    if (!response.ok) throw new Error(body.error || '当前连接读取失败。')
    return body.data?.connection || null
  }, [provider.key])

  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setConnection(null)
    setReport(null)
    setFailure('')
    void loadConnection(controller.signal).then(value => {
      if (!controller.signal.aborted) setConnection(value)
    }).catch(error => {
      if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : '当前连接读取失败。')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => request.current?.abort()
  }, [loadConnection])

  async function inspect() {
    if (inFlight.current || loading) return
    inFlight.current = true
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setReading(true)
    setReport(null)
    setFailure('')
    try {
      // Re-read the saved revision for every attempt. Draft form values are never
      // used, and a prior report cannot survive a failed or changed connection.
      const current = await loadConnection(controller.signal)
      if (!current?.configured) throw new Error('请先配置目录连接。')
      if (controller.signal.aborted) return
      setConnection(current)
      const response = await fetch('/api/admin/organization-sources/inspection', {
        method: 'POST', headers: headers(true), cache: 'no-store', signal: controller.signal,
        body: JSON.stringify({ provider: provider.key, sourceId: current.sourceId, revision: current.revision }),
      })
      const body = await response.json().catch(() => ({})) as { data?: { report?: DirectoryInspection }; error?: string }
      if (!response.ok || !body.data?.report) throw new Error(body.error || '目录核验未完成。')
      if (controller.signal.aborted) return
      const next = body.data.report
      if (next.binding.provider !== provider.key || next.binding.sourceId !== current.sourceId
        || next.binding.connectionRevision !== current.revision || next.binding.externalTenantId !== current.externalTenantId) {
        throw new Error('目录结果与当前连接不一致，请重新核验。')
      }
      setReport(next)
    } catch (error) {
      if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : '目录核验未完成。')
    } finally {
      inFlight.current = false
      if (!controller.signal.aborted) setReading(false)
    }
  }

  const names = new Map(report?.departments.map(department => [department.id, department.name]) || [])
  return (
    <section aria-label={`${provider.label}目录范围核验`} className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h4 className="font-medium text-slate-900">目录范围核验</h4>
        <p className="mt-1 text-sm text-slate-600">使用已保存连接读取本次目录，核对企业、部门关系和人员状态。不会改变连接状态或系统组织。</p>
      </div>
      {connection?.state === 'disabled' && <p className="text-sm text-amber-800">此来源已停用。管理员可以主动只读核验，核验后仍保持停用。</p>}
      <Button type="button" variant="outline" disabled={loading || reading || !provider.previewAvailable || !connection?.configured} onClick={() => void inspect()}>
        {loading ? '正在读取连接…' : reading ? '正在核验目录…' : '只读核验目录'}
      </Button>
      {!loading && !connection && !failure && <p className="text-sm text-slate-600">尚未配置可核验的连接。</p>}
      {failure && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{failure} 当前没有有效的新核验结果。</p>}
      {report && (
        <div className="space-y-3" data-testid="directory-inspection-report">
          <p className="font-medium">本次读取：{report.departments.length} 个部门、{report.employees.length} 位员工</p>
          <dl className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <div><dt className="text-slate-500">外部企业</dt><dd className="break-all">{report.binding.externalTenantId}</dd></div>
            <div><dt className="text-slate-500">读取时间</dt><dd>{Number.isFinite(Date.parse(report.checkedAt)) ? new Date(report.checkedAt).toLocaleString('zh-CN') : '读取时间待核对'}</dd></div>
          </dl>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">全公司范围未证明</p>
            <p className="mt-1">{report.scope.reason}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">{report.scope.requiredEvidence.map(item => <li key={item}>{item}</li>)}</ul>
          </div>
          <p className={report.structure.complete ? 'text-sm text-slate-700' : 'text-sm text-rose-800'}>
            {report.structure.complete ? '本次返回的目录结构检查通过；范围仍待独立核对。' : `目录结构存在 ${report.structure.issues.length} 项问题，须先核对。`}
          </p>
          {report.structure.issues.length > 0 && <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-5 text-sm text-rose-800">
            {report.structure.issues.map((issue, index) => <li key={`${issue.code}:${issue.externalId}:${index}`}>{issue.externalId ? `${issue.externalId}：` : ''}{issue.message}</li>)}
          </ul>}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-blue-700">查看部门与人员明细</summary>
            <div className="mt-2 grid gap-3 lg:grid-cols-2">
              <ul aria-label="核验部门明细" className="max-h-72 space-y-2 overflow-auto rounded border p-3 text-sm">
                {report.departments.map((department, index) => <li key={`${department.id}:${index}`}>
                  {department.name}（{department.id}） · 上级：{department.parentId ? names.get(department.parentId) || department.parentId : '无'} · {statusLabel(department.status)}
                </li>)}
              </ul>
              <ul aria-label="核验员工明细" className="max-h-72 space-y-2 overflow-auto rounded border p-3 text-sm">
                {report.employees.map((employee, index) => <li key={`${employee.id}:${index}`}>
                  {employee.name}（{employee.id}） · 主属：{employee.primaryDepartmentId ? names.get(employee.primaryDepartmentId) || employee.primaryDepartmentId : '未确定'} · 附属：{employee.departmentIds.filter(id => id !== employee.primaryDepartmentId).map(id => names.get(id) || id).join('、') || '无'} · {statusLabel(employee.status)}
                </li>)}
              </ul>
            </div>
          </details>
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer">核验记录标识</summary>
            <dl className="mt-2 space-y-1 break-all">
              <div><dt>连接版本</dt><dd>{report.binding.connectionRevision}</dd></div>
              <div><dt>目录内容摘要</dt><dd>{report.contentHash}</dd></div>
              <div><dt>本次核验标识</dt><dd>{report.observationHash}</dd></div>
            </dl>
          </details>
          <p className="text-xs text-slate-500">此记录仅反映读取时的数据。连接、权限范围或目录变化后须重新核验，不能作为当前全公司范围已通过的凭证。</p>
        </div>
      )}
    </section>
  )
}
