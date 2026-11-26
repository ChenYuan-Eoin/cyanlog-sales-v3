'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { LedgerDepartment } from '@/lib/shipping/department-ledger-access'
import type { ShipmentOrder, ShipmentOrderStatus } from '@/lib/shipping/types'
import { shippingWorkbenchRequest } from '@/lib/shipping/workbench-client'
import { allLedgerDepartments, DepartmentLedgerFilter, ledgerDepartmentQuery, type LedgerDepartmentSelection } from './department-ledger-filter'
import styles from './workspace.module.css'

const ledgerUrl = '/api/shipping/ledger'
const pageSize = 50
const time = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
})
const statusLabels: Record<ShipmentOrderStatus, string> = {
  accepted: '已受理', awaiting_confirmation: '待审核', returned: '工单已退回', resubmitted: '已重提',
  confirmed: '已确认', ordering: '下单中', order_unknown: '结果待确认', waybill_created: '待揽收',
  in_transit: '运输中', delivered: '已签收', cancelled: '已取消', order_failed: '异常件',
}

type Selection = LedgerDepartmentSelection & { page: number }
type LedgerPage = { records: ShipmentOrder[]; nextPage: number | null }

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : time.format(date)
}

function customerLabel(record: ShipmentOrder) {
  return record.input?.customerName || record.relation?.customerRef || '未填写客户'
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : '寄件台账暂不可用，请重试。'
}

function SavedShipmentDetails({ recordId, scopeQuery }: { recordId: string; scopeQuery: string }) {
  const [record, setRecord] = useState<ShipmentOrder | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const url = `${ledgerUrl}/${encodeURIComponent(recordId)}${scopeQuery ? `?${scopeQuery}` : ''}`
    void shippingWorkbenchRequest<{ record: ShipmentOrder }>(url, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return
        if (result.record?.id !== recordId) throw new Error('无法核对寄件详情。')
        setRecord(result.record)
      })
      .catch(problem => { if (!controller.signal.aborted) setError(readError(problem)) })
    return () => controller.abort()
  }, [recordId, scopeQuery])

  if (error) return <p role="alert" className={styles.error}>{error}</p>
  if (!record) return <p role="status" className={styles.subtle}>正在读取寄件详情…</p>

  const events = Array.isArray(record.trackingEvents) ? record.trackingEvents : []
  return <section className="mt-3 rounded-lg border p-4" aria-label="寄件详情">
    <h3 className="text-sm font-semibold">{customerLabel(record)}</h3>
    <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
      <div><dt className="font-medium">寄件人</dt><dd>{record.input?.sender?.name || '—'}</dd></div>
      <div><dt className="font-medium">收件人</dt><dd>{record.input?.recipient?.name || '—'}</dd></div>
      <div><dt className="font-medium">托寄物</dt><dd>{record.input?.cargo || '—'}</dd></div>
      <div><dt className="font-medium">运单号</dt><dd>{record.waybill || '—'}</dd></div>
    </dl>
    <h4 className="mb-2 mt-4 text-xs font-semibold">已保存物流</h4>
    {events.length ? <ul className="space-y-2 text-xs">
      {events.map((event, index) => (
        <li key={`${event.time}:${index}`}><span>{formatTime(event.time)}</span> {event.location} {event.description}</li>
      ))}
    </ul> : <p className="text-xs text-slate-500">暂无已保存的物流记录</p>}
  </section>
}

function DepartmentLedgerRecords({ requestUrl, scopeQuery, page, onPageChange }: {
  requestUrl: string; scopeQuery: string; page: number; onPageChange: (next: number) => void
}) {
  const [result, setResult] = useState<LedgerPage | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void shippingWorkbenchRequest<LedgerPage>(requestUrl, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return
        if (!Array.isArray(data.records) || (data.nextPage !== null && data.nextPage !== page + 1)
          || data.records.some(record => typeof record?.id !== 'string' || typeof record.orderNo !== 'string')) {
          throw new Error('寄件台账响应不完整，请重试。')
        }
        setResult(data)
      })
      .catch(problem => { if (!controller.signal.aborted) setError(readError(problem)) })
    return () => controller.abort()
  }, [page, requestUrl, retry])

  if (error) return <div className="space-y-2 py-3">
    <p role="alert" className={styles.error}>{error}</p>
    <button type="button" className={styles.secondary} onClick={() => { setError(''); setRetry(current => current + 1) }}>重新读取</button>
  </div>
  if (!result) return <p role="status" className={styles.subtle}>正在读取寄件台账…</p>

  return <>
    {result.records.length === 0 ? <p className={styles.subtle}>当前范围暂无寄件记录。</p> : (
      <div className={styles.ledgerList}>
        {result.records.map(record => (
          <div key={record.id}>
            <article className={styles.ledgerRow}>
              <div><strong>{customerLabel(record)}</strong><small>{formatTime(record.createdAt)}</small></div>
              <div><span>提报人 {record.input?.submittedBy?.name || '—'}</span>
                <span>收件人 {record.input?.recipient?.name || '—'}</span></div>
              <div><span>{record.trackingStatus === 'out_for_delivery' && record.status === 'in_transit' ? '派送中' : statusLabels[record.status] ?? '状态待核对'}</span>
                <span>运单号 {record.waybill || '—'}</span></div>
              <div className={styles.ledgerActions}>
                <button type="button" className={styles.secondary} aria-expanded={selectedRecordId === record.id}
                  aria-label={`${selectedRecordId === record.id ? '收起' : '查看'}寄件详情 ${record.orderNo}`}
                  onClick={() => setSelectedRecordId(current => current === record.id ? null : record.id)}>
                  {selectedRecordId === record.id ? '收起详情' : '查看详情'}
                </button>
              </div>
            </article>
            {selectedRecordId === record.id && <SavedShipmentDetails recordId={record.id} scopeQuery={scopeQuery} />}
          </div>
        ))}
      </div>
    )}
    {(page > 0 || result.nextPage !== null) && <nav aria-label="寄件台账分页" className="mt-4 flex items-center justify-end gap-3">
      <button type="button" className={styles.secondary} disabled={page === 0} onClick={() => onPageChange(page - 1)}>上一页</button>
      <span className="text-xs">第 {page + 1} 页</span>
      <button type="button" className={styles.secondary} disabled={result.nextPage === null}
        onClick={() => { if (result.nextPage !== null) onPageChange(result.nextPage) }}>下一页</button>
    </nav>}
  </>
}

export default function DepartmentLedger({ departments, canViewOwn, canManageConnections }: {
  departments: LedgerDepartment[]; canViewOwn: boolean; canManageConnections: boolean
}) {
  const [selection, setSelection] = useState<Selection>({ ...allLedgerDepartments, page: 0 })
  const authorizedTreeKey = useMemo(() => JSON.stringify(departments.map(department => [department.id, department.parentId]).sort()), [departments])
  const selectionAllowed = !selection.departmentId || departments.some(department => department.id === selection.departmentId)
  const visibleSelection = selectionAllowed ? selection : { ...allLedgerDepartments, page: 0 }
  const { page } = visibleSelection
  const scope = ledgerDepartmentQuery(visibleSelection)
  const query = new URLSearchParams(scope)
  query.set('page', String(page))
  query.set('limit', String(pageSize))
  const requestUrl = `${ledgerUrl}?${query}`

  return <main className={styles.workspace}>
    <header className={styles.header}>
      <div><h1>收寄台账</h1><p>查看获授权部门的寄件记录和已保存物流。</p></div>
      {(canViewOwn || canManageConnections) && <nav aria-label="寄件入口" className="flex flex-wrap gap-2">
        {canViewOwn && <Link className={styles.secondary} href="/sales-portal">本人寄件</Link>}
        {canManageConnections && <Link className={styles.secondary} href="/shipping/settings">寄件设置</Link>}
      </nav>}
    </header>
    <section className={`${styles.panel} ${styles.ledgerPanel} mx-auto`} aria-label="部门寄件记录">
      <div className={styles.panelBody}>
        <div className="mb-4">
          <DepartmentLedgerFilter departments={departments} selection={visibleSelection}
            onChange={scope => setSelection({ ...scope, page: 0 })} />
        </div>
        <DepartmentLedgerRecords key={`${authorizedTreeKey}:${requestUrl}`} requestUrl={requestUrl} scopeQuery={scope.toString()} page={page}
          onPageChange={nextPage => setSelection({ ...visibleSelection, page: nextPage })} />
      </div>
    </section>
  </main>
}
