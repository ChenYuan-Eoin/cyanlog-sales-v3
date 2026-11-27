'use client'

import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { confirmAction } from '@/lib/toast'
import type { DepartmentOverrideChoice } from '@/lib/admin/member-department-save-contract'
import type { OrgSummaryDepartment } from '../../types'

const ROUTE = '/api/admin/departments/disposal'
const PAGE_SIZE = 15
const selectStyle = 'rounded border border-slate-300 bg-white px-2 py-1.5 text-sm'

type Department = {
  departmentId: string; parentDepartmentId: string | null; name: string; source: string; status: string;
  selected: boolean; activeChildIds: string[]; memberCount: number; blockedReason: string | null;
}
type Relation = { departmentId: string; name: string; source: string; kind: 'primary' | 'secondary'; manageable: boolean; blockedReason: string | null }
type Member = {
  userId: string; displayName: string; employmentStatus: string; accountStatus: string; loginEnabled: boolean;
  primaryDepartmentId: string | null; relations: Relation[]; canTransfer: boolean; canSuspend: boolean; canOffboard: boolean;
}
type ResultRow = {
  userId?: string; departmentId?: string; action: string;
  status: 'ready' | 'applied' | 'unchanged' | 'blocked' | 'needs_review';
  code?: string; details?: unknown; reason?: string;
}
type Plan = {
  planId: string; planHash: string; expiresAt: string; departments: Department[]; members: Member[]; hiddenMemberCount: number;
  summary: { departmentCount: number; memberCount: number; visibleMemberCount: number; relationCount: number };
  memberResults?: ResultRow[]; departmentResults?: ResultRow[];
}
type Command = {
  transfers?: Array<{ userId: string; departmentId: string; choiceId?: string; overrideChoice?: DepartmentOverrideChoice }>;
  secondaryRemovals?: Array<{ userId: string; departmentIds: string[]; choiceId?: string; overrideChoice?: DepartmentOverrideChoice }>;
  suspendUserIds?: string[]; offboardUserIds?: string[]; reparent?: Array<{ departmentId: string; parentDepartmentId: string }>;
  archiveDepartmentIds?: string[];
}
type HeadersForRequest = (json?: boolean) => HeadersInit
type EmploymentFilter = 'active' | 'all'
type Operation = '' | 'transfer' | 'secondary' | 'suspend' | 'offboard'
type Choice = { choiceId: string; overrideChoice: DepartmentOverrideChoice }
type DepartmentTarget = Pick<OrgSummaryDepartment, 'id' | 'name'>
type ReparentSelection = { departmentName: string; target: DepartmentTarget }

const operationNames: Record<string, string> = {
  transfer: '转移主部门', transfer_primary: '转移主部门', remove_secondary: '解除兼岗',
  secondary_removal: '解除兼岗', secondary: '解除兼岗', suspend: '停用账号', offboard: '办理离职',
  reparent: '调整上级部门', archive: '归档部门',
}
const statusNames: Record<ResultRow['status'], string> = {
  ready: '可执行', applied: '已执行', unchanged: '无需变更', blocked: '受阻', needs_review: '待复核权限',
}
const knownReasons: Record<string, string> = {
  DEPARTMENT_HAS_MEMBER_BINDINGS: '仍有关联人员，请先转移主部门或解除兼岗。',
  DEPARTMENT_HAS_ACTIVE_CHILDREN: '仍有有效下级，请改挂上级或纳入本批归档。',
  DEPARTMENT_SOURCE_PROTECTED: '由外部来源维护，请到外部系统接入处理。',
  LAST_SUPER_ADMIN: '当前变更会影响最后一名可登录超管。',
  DEPARTMENT_ROOT_PROTECTED: '组织根部门受保护。',
  DEPARTMENT_SOURCE_OR_PRIMARY_PROTECTED: '主部门由外部来源维护或关系已变化。',
  DEPARTMENT_NOT_FOUND: '当前组织找不到该部门，请刷新。',
  DEPARTMENT_TRANSFER_INVALID_TARGET: '承接部门已停用或在待归档子树内，请重新选择。',
  DEPARTMENT_PARENT_INVALID: '所选上级无效、在待归档子树内或会形成循环。',
  DEPARTMENT_HAS_ACTIVE_SALES_SPACE: '部门仍有有效销售空间，请先处理。',
  DEPARTMENT_ARCHIVE_AUTHORITY_PROTECTED: '部门仍有无法自动处理的授权，请核对授权范围。',
  DEPARTMENT_OVERRIDE_CHOICE_REQUIRED: '调岗会影响个人权限，请选择使用新权限或保留适用差异。',
  DEPARTMENT_DISPOSAL_STALE: '部门或关系已变化，请重新预览。',
  DEPARTMENT_RELATION_STALE: '人员关系已变化，请重新核对。',
  SECONDARY_RELATION_PROTECTED: '所选兼岗已变化或由外部来源维护。',
  DEPARTMENT_INACTIVE: '部门已停用，须在历史停用记录中核对。',
  LEGACY_INACTIVE_REVIEW: '历史停用记录，需先核对来源和用途。',
  MEMBER_MUTATION_PROTECTED: '当前账号或系统超级管理员受保护。',
  MEMBER_NOT_ELIGIBLE: '成员的账号、在职状态或权限限制该动作。',
  ALREADY_ARCHIVED: '此前已归档，可在已归档部门中查看。',
  ALREADY_IN_DESTINATION: '成员已在所选承接部门。',
  DEPARTMENT_PARENT_UNCHANGED: '部门已在所选上级下。',

}
function textDetail(value: unknown) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    if ('message' in value && typeof value.message === 'string') return value.message
    if ('reason' in value && typeof value.reason === 'string') return value.reason
  }
  return ''
}
function reasonFor(value: string | null | undefined): string {
  if (!value) return ''
  return knownReasons[value] || (/^[A-Z_0-9]+$/.test(value) ? '当前对象仍有处置限制，请核对部门来源、人员或下级部门。' : value)
}
function linkedNames(details: unknown, key: 'members' | 'activeChildren', label: 'displayName' | 'name') {
  if (!details || typeof details !== 'object' || !(key in details)) return []
  const rows = (details as Record<string, unknown>)[key]
  if (!Array.isArray(rows)) return []
  return rows.flatMap(row => typeof row?.[label] === 'string' ? [String(row[label])] : [])
}
function getChoiceId(details: unknown) {
  if (!details || typeof details !== 'object') return null
  if ('choiceId' in details && typeof details.choiceId === 'string') return details.choiceId
  if ('choice_id' in details && typeof details.choice_id === 'string') return details.choice_id
  return null
}
function labelSource(source: string) {
  const labels: Record<string, string> = { manual: '自建', feishu: '飞书', fxiaoke: '纷享', wecom: '企业微信', dingtalk: '钉钉' }
  return labels[source] || '组织来源'
}
function toggle(set: Set<string>, id: string, checked: boolean) {
  const next = new Set(set)
  if (checked) next.add(id)
  else next.delete(id)
  return next
}
function availableTarget(department: OrgSummaryDepartment, parents: Map<string, string | null | undefined>, excluded: ReadonlySet<string>) {
  const seen = new Set<string>()
  let id: string | null | undefined = department.id
  while (id) {
    if (excluded.has(id) || seen.has(id)) return false
    seen.add(id)
    id = parents.get(id)
  }
  return !department.status || department.status === 'active'
}

async function requestData<T>(headers: HeadersForRequest, options: { body?: object; query?: URLSearchParams; signal?: AbortSignal }) {
  const res = await fetch(options.query ? `${ROUTE}?${options.query}` : ROUTE, {
    ...(options.body ? { method: 'POST', body: JSON.stringify(options.body) } : {}),
    headers: headers(Boolean(options.body)), signal: options.signal, cache: 'no-store',
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(textDetail(payload?.error) || '操作暂未确认，请刷新后核对。'), {
    code: typeof payload?.code === 'string' ? payload.code : null,
  })
  if (!payload?.data) throw new Error('收到的处置结果不完整，请刷新后核对。')
  return payload.data as T
}

type Props = {
  orgId: string;
  departmentIds: string[];
  departments: OrgSummaryDepartment[];
  initialEmploymentFilter: EmploymentFilter;
  authHeaders: HeadersForRequest;
  canArchive: boolean;
  canReparent: boolean;
  onArchived: (ids: string[]) => void;
  onRefresh?: () => void | Promise<void>;
  onOpenIntegrations?: () => void;
}

export function DepartmentDisposalPanel(props: Props) {
  const scopeId = useId()
  const [includeChildren, setIncludeChildren] = useState(false)
  const [employmentFilter, setEmploymentFilter] = useState(props.initialEmploymentFilter)
  const [readVersion, refreshPreview] = useState(0)
  return (
    <section className="space-y-4 rounded-lg border bg-white p-4" aria-labelledby={scopeId}>
      <div>
        <h3 className="font-medium text-slate-900" id={scopeId}>部门批量处置</h3>
        <p className="mt-1 text-sm text-slate-600">在部门树勾选部门并核对人员关系。已勾选 {props.departmentIds.length} 个部门。</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">关系范围{' '}
          <select className={selectStyle} value={includeChildren ? 'descendants' : 'direct'}
            onChange={event => setIncludeChildren(event.target.value === 'descendants')}>
            <option value="direct">仅本部门</option><option value="descendants">含下级部门</option>
          </select>
        </label>
        <label className="text-sm">处置成员状态{' '}
          <select className={selectStyle} value={employmentFilter}
            onChange={event => setEmploymentFilter(event.target.value === 'all' ? 'all' : 'active')}>
            <option value="active">在职且账号启用</option><option value="all">全部</option>
          </select>
        </label>
      </div>
      {props.departmentIds.length > 0 && (
        <DisposalSelection key={JSON.stringify([props.departmentIds, includeChildren, employmentFilter, readVersion])}
          {...props} employmentFilter={employmentFilter} includeChildren={includeChildren}
          showAll={() => setEmploymentFilter('all')} reload={() => refreshPreview(version => version + 1)} />
      )}
    </section>
  )
}

function DisposalSelection({
  orgId, departmentIds, departments, authHeaders, employmentFilter, includeChildren, canArchive, canReparent,
  showAll, reload, onArchived, onRefresh, onOpenIntegrations,
}: Props & { employmentFilter: EmploymentFilter; includeChildren: boolean; showAll: () => void; reload: () => void }) {
  const [snapshot, setSnapshot] = useState<Plan | null>(null)
  const [previewed, setPreviewed] = useState<{ selection: string; plan: Plan } | null>(null)
  const [result, setResult] = useState<Plan | null>(null)
  const [picked, setPicked] = useState(new Set<string>())
  const [archiveIds, setArchiveIds] = useState(new Set<string>())
  const [secondaryIds, setSecondaryIds] = useState(new Set<string>())
  const [reparentTargets, setReparentTargets] = useState<Record<string, ReparentSelection>>({})
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [page, setPage] = useState(0)
  const [operation, setOperation] = useState<Operation>('')
  const [target, setTarget] = useState<DepartmentTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const resultId = useId()

  useEffect(() => {
    const controller = new AbortController()
    void requestData<Plan>(authHeaders, {
      body: { action: 'preview', expectedOrgId: orgId, departmentIds, includeChildren, employmentFilter, command: {} },
      signal: controller.signal,
    }).then(data => { if (!controller.signal.aborted) setSnapshot(data) })
      .catch((error: unknown) => { if (!controller.signal.aborted) setFailure(textDetail(error)) })
    return () => controller.abort()
  }, [authHeaders, departmentIds, includeChildren, employmentFilter, orgId])

  if (!snapshot) {
    return failure ? <div className="space-y-2"><p role="alert">{failure}</p><Button type="button" variant="outline" onClick={reload}>重新读取</Button></div>
      : <p role="status" className="text-sm text-slate-600">正在读取当前部门和人员关系…</p>
  }

  const current = result || snapshot
  const { members } = current
  const pickedMembers = members.filter(member => picked.has(member.userId))
  const pageCount = Math.max(1, Math.ceil(members.length / PAGE_SIZE))
  const displayPage = Math.min(page, pageCount - 1)
  const visibleMembers = members.slice(displayPage * PAGE_SIZE, (displayPage + 1) * PAGE_SIZE)
  const departmentById = new Map(departments.map(department => [department.id, department]))
  const parents = new Map(departments.map(row => [row.id, row.parent_id]))
  const allowedTargets = departments.filter(department => availableTarget(department, parents, archiveIds))
  const archivePicked = current.departments.filter(department => archiveIds.has(department.departmentId))
  const reparentChildren = new Map(Object.entries(reparentTargets).map(([id, item]) => [id, item.departmentName]))
  if (canReparent) {
    for (const department of archivePicked) {
      for (const childId of department.activeChildIds) {
        const child = current.departments.find(row => row.departmentId === childId) || departmentById.get(childId)
        if (child?.source === 'manual' && !archiveIds.has(childId)) reparentChildren.set(childId, child.name)
      }
    }
  }
  const reparentFields = [...reparentChildren].map(([id, name]) => {
    const selected = reparentTargets[id]?.target
    const excluded = new Set([id])
    const options = canReparent ? allowedTargets.filter(department => availableTarget(department, parents, excluded)) : []
    return { id, name, selected, options, unavailable: !!selected && !options.some(department => department.id === selected.id) }
  })
  const transferMembers = operation === 'transfer' ? pickedMembers.filter(row => row.relations.some(relation => relation.kind === 'primary')) : []
  const transferUnavailable = operation === 'transfer' && !!target && !allowedTargets.some(row => row.id === target.id)
  const transferNeedsTarget = transferMembers.length > 0 && !target
  const rowsFor = (plan: Plan | null) => [...(plan?.memberResults || []), ...(plan?.departmentResults || [])]
  const names = new Map([...departments.map(row => [row.id, row.name] as const), ...reparentChildren,
    ...snapshot.members.map(row => [row.userId, row.displayName] as const),
    ...snapshot.departments.map(row => [row.departmentId, row.name] as const)])
  const commands: Command = {
    archiveDepartmentIds: archivePicked.map(row => row.departmentId),
    reparent: Object.entries(reparentTargets).map(([departmentId, item]) => ({
      departmentId, parentDepartmentId: item.target.id,
    })),
  }
  if (operation === 'transfer' && target) {
    commands.transfers = transferMembers.map(row => ({ userId: row.userId, departmentId: target.id, ...choices[row.userId] }))
  } else if (operation === 'secondary') {
    commands.secondaryRemovals = pickedMembers.flatMap(row => {
      const ids = row.relations.filter(relation => relation.kind === 'secondary'
        && secondaryIds.has(JSON.stringify([row.userId, relation.departmentId]))).map(relation => relation.departmentId)
      return ids.length ? [{ userId: row.userId, departmentIds: ids, ...choices[row.userId] }] : []
    })
  } else if (operation === 'suspend') {
    commands.suspendUserIds = pickedMembers.map(row => row.userId)
  } else if (operation === 'offboard') {
    commands.offboardUserIds = pickedMembers.map(row => row.userId)
  }
  const cannotEditSelection = (!canArchive && archivePicked.length > 0)
    || (!canReparent && Object.keys(reparentTargets).length > 0)
  const canPreview = !transferNeedsTarget && !cannotEditSelection && Object.values(commands).some(rows => rows.length > 0)
  const selection = JSON.stringify([commands, transferUnavailable, reparentFields.filter(field => field.unavailable).map(field => field.id)])
  const review = canPreview && previewed?.selection === selection ? previewed.plan : null

  function editSelection() {
    setPreviewed(null)
    setFailure('')
  }

  async function prepare() {
    if (busy || !canPreview) return
    setBusy(true)
    setFailure('')
    try {
      const plan = await requestData<Plan>(authHeaders, {
        body: { action: 'preview', expectedOrgId: orgId, departmentIds, includeChildren, employmentFilter, command: commands },
      })
      setPreviewed({ selection, plan })
    } catch (error) { setFailure(textDetail(error)) }
    finally { setBusy(false) }
  }

  async function apply() {
    if (busy || !review || !rowsFor(review).some(row => row.status === 'ready')) return
    setBusy(true)
    setFailure('')
    try {
      const rows = rowsFor(review)
      const highRisk = rows.filter(row => ['offboard', 'suspend', 'archive'].includes(row.action) && row.status === 'ready')
      const describe = (rows: ResultRow[]) => rows.map(row =>
        `${operationNames[row.action] || '处置'} ${names.get(row.userId || row.departmentId || '') || '所选对象'}`).join('；')
      const blocked = rows.filter(row => row.status === 'blocked' || row.status === 'needs_review')
      const message = [
        highRisk.length ? describe(highRisk) : '应用本次可执行的处置项目。',
        blocked.length ? `保留以下仍需处理的项目：${describe(blocked)}` : '',
      ].filter(Boolean).join('\n')
      if (!await confirmAction(message, {
        title: '确认部门处置', confirmText: '应用处置方案', danger: highRisk.length > 0,
      })) return

      const applied = await requestData<Plan>(authHeaders, { body: { action: 'apply', expectedOrgId: orgId, planId: review.planId, planHash: review.planHash } })
      setResult(applied)
      setPreviewed(null)
      const completedReparents = new Set((applied.departmentResults || []).filter(row => row.action === 'reparent'
        && (row.status === 'applied' || row.status === 'unchanged')).map(row => row.departmentId))
      if (completedReparents.size > 0) {
        setReparentTargets(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !completedReparents.has(id))))
      }
      const archived = (applied.departmentResults || []).flatMap(row => ['archive', 'archive_department'].includes(row.action)
        && row.departmentId && row.status === 'applied' ? [row.departmentId] : [])
      onArchived(archived)
      try { await onRefresh?.() } catch { setFailure('处置结果已返回，组织架构暂未刷新，请重新读取。') }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'DISPOSAL_STALE') setPreviewed(null)
      setFailure(textDetail(error))
    }
    finally { setBusy(false) }
  }

  function renderResults(plan: Plan, title: string) {
    const rows = rowsFor(plan)
    if (!rows.length) return null
    const heading = resultId + title
    return (
      <div className="rounded border border-slate-200 p-3">
        <h4 id={heading} className="font-medium">{title}</h4>
        <ul className="mt-2 space-y-2 text-sm" aria-labelledby={heading}>
          {rows.map((row, index) => {
            const id = row.userId || row.departmentId || ''
            const choiceId = row.userId ? getChoiceId(row.details) : null
            const relatedMembers = linkedNames(row.details, 'members', 'displayName')
            const relatedChildren = linkedNames(row.details, 'activeChildren', 'name')
            return <li key={JSON.stringify([id, row.action, index])}>
              <strong>{names.get(id) || '所选对象'}</strong> · {operationNames[row.action] || '处置'} · {statusNames[row.status]}
              {(row.reason || row.code || textDetail(row.details)) && <p className="text-slate-600">{textDetail(row.details) || reasonFor(row.reason || row.code)}</p>}
              {relatedMembers.length > 0 && <p className="text-slate-600">关联成员 {relatedMembers.join('、')}</p>}
              {relatedChildren.length > 0 && <p className="text-slate-600">有效下级 {relatedChildren.join('、')}</p>}
              {row.status === 'needs_review' && choiceId ? (
                <label className="text-sm">权限差异{' '}
                  <select className={selectStyle} value={choices[id]?.overrideChoice || ''} disabled={busy}
                    onChange={event => {
                      const value = event.target.value
                      setChoices(previous => {
                        const next = { ...previous }
                        if (value === 'new_baseline' || value === 'retain_eligible') next[id] = { choiceId, overrideChoice: value }
                        else delete next[id]
                        return next
                      })
                      editSelection()
                    }}>
                    <option value="">请选择</option><option value="new_baseline">使用新部门权限</option>
                    <option value="retain_eligible">保留仍适用的权限差异</option>
                  </select>
                </label>
              ) : null}
            </li>
          })}
        </ul>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">涉及 {current.summary.departmentCount} 个部门、{current.summary.memberCount} 名成员、{current.summary.relationCount} 条关系。</p>
      {current.hiddenMemberCount > 0 && <div role="status" className="flex flex-wrap items-center gap-2 rounded bg-amber-50 p-2 text-sm text-amber-950">
        当前筛选隐藏 {current.hiddenMemberCount} 名关联成员，仍可能阻挡归档。
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={showAll}>查看全部关联成员</Button>
      </div>}
      <ul className="space-y-2 rounded border p-3 text-sm" aria-label="本批部门与归档选择">
        {current.departments.map(department => (
          <li key={department.departmentId} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {(canArchive || archiveIds.has(department.departmentId)) && department.status !== 'archived' && <Checkbox aria-label={`归档 ${department.name}`}
                checked={archiveIds.has(department.departmentId)} disabled={busy || (!archiveIds.has(department.departmentId)
                  && (!canArchive || department.source !== 'manual' || department.status !== 'active' || department.blockedReason === 'DEPARTMENT_ROOT_PROTECTED'))}
                onCheckedChange={checked => { setArchiveIds(value => toggle(value, department.departmentId, checked === true)); editSelection() }} />}
              <strong>{department.name}</strong> · {labelSource(department.source)} · {department.memberCount} 名关联成员
              {department.activeChildIds.length > 0 && <span>· {department.activeChildIds.length} 个有效下级</span>}
              {department.blockedReason && <span className="text-amber-800">{reasonFor(department.blockedReason)}</span>}
              {department.source !== 'manual' && onOpenIntegrations && <Button type="button" size="sm" variant="ghost" onClick={onOpenIntegrations}>前往外部系统接入</Button>}
            </div>
          </li>
        ))}
      </ul>
      {reparentFields.length > 0 && (
        <ul className="space-y-2 rounded border p-3 text-sm" aria-label="改挂上级选择">
          {reparentFields.map(({ id, name, selected, options, unavailable }) => (
            <li key={id} className="space-y-1">
              <label>
                为 <strong>{name}</strong> 改挂上级{' '}
                <select className={selectStyle} value={selected?.id || ''} disabled={busy}
                  onChange={event => {
                    const parent = departmentById.get(event.target.value)
                    setReparentTargets(previous => {
                      const next = { ...previous }
                      if (parent) next[id] = { departmentName: name, target: parent }
                      else delete next[id]
                      return next
                    })
                    editSelection()
                  }}>
                  <option value="">保持当前上级</option>
                  {unavailable && selected && <option value={selected.id} disabled>{selected.name}（当前不可用）</option>}
                  {options.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </label>
              {unavailable && selected && <p role="status" className="text-amber-800">
                「{name}」已选上级「{selected.name}」当前不可用。请重新选择，或在预览中核对这项改挂。
              </p>}
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={pickedMembers.length === members.length && members.length > 0 ? true : pickedMembers.length > 0 ? 'indeterminate' : false}
              disabled={busy || members.length === 0} onCheckedChange={checked => {
                setPicked(new Set(checked === true ? members.map(row => row.userId) : [])); editSelection()
              }} />
            全选当前范围 ({members.length} 人，含全部页)
          </label>
          <span aria-live="polite" className="text-sm">已选 {pickedMembers.length} 人</span>
        </div>
        <ul className="divide-y overflow-hidden rounded border" aria-label="本批关联成员">
          {visibleMembers.map(member => <li key={member.userId} className="space-y-1 p-3 text-sm">
            <label className="flex flex-wrap items-center gap-2">
              <Checkbox checked={picked.has(member.userId)} disabled={busy} aria-label={`选择员工 ${member.displayName}`}
                onCheckedChange={checked => { setPicked(value => toggle(value, member.userId, checked === true)); editSelection() }} />
              <strong>{member.displayName}</strong>
              <span>{member.employmentStatus === 'active' ? '在职' : member.employmentStatus === 'ended' ? '已离职' : '非在职'}</span>
              {!member.loginEnabled && <span>账号已停用</span>}
              {((operation === 'transfer' && !member.canTransfer) || (operation === 'suspend' && !member.canSuspend)
                || (operation === 'offboard' && !member.canOffboard)) && (
                <span className="text-amber-800">此成员的当前状态限制所选动作</span>
              )}
            </label>
            <ul className="ml-6 space-y-1 text-slate-700">
              {member.relations.map(relation => {
                const key = JSON.stringify([member.userId, relation.departmentId])
                return <li key={key} className="flex flex-wrap items-center gap-2">
                  {operation === 'secondary' && relation.kind === 'secondary' && <Checkbox checked={secondaryIds.has(key)}
                    aria-label={`解除 ${member.displayName} 的 ${relation.name} 兼岗`} disabled={busy || !relation.manageable || !picked.has(member.userId)}
                    onCheckedChange={checked => { setSecondaryIds(value => toggle(value, key, checked === true)); editSelection() }} />}
                  {relation.kind === 'primary' ? '主属' : '兼岗'} · {relation.name} · {labelSource(relation.source)}
                  {relation.blockedReason && <span className="text-amber-800">{reasonFor(relation.blockedReason)}</span>}
                </li>
              })}
            </ul>
          </li>)}
        </ul>
        {members.length === 0 && <p className="text-sm text-slate-600">当前范围没有可见的关联人员。</p>}
        {pageCount > 1 && <div className="flex items-center justify-end gap-2 text-sm">
          <span>第 {displayPage + 1} / {pageCount} 页</span>
          <Button type="button" size="sm" variant="outline" disabled={busy || displayPage === 0} onClick={() => setPage(displayPage - 1)}>上一页关系</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy || displayPage + 1 === pageCount} onClick={() => setPage(displayPage + 1)}>下一页关系</Button>
        </div>}
        {members.length > 0 && <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">人员处置{' '}
            <select className={selectStyle} value={operation} disabled={busy}
              onChange={event => { setOperation(event.target.value as Operation); setChoices({}); editSelection() }}>
              <option value="">选择动作</option>
              <option value="transfer" disabled={!members.some(member => member.canTransfer)}>转移主部门</option>
              <option value="secondary" disabled={!members.some(member => member.relations.some(rel => rel.kind === 'secondary' && rel.manageable))}>解除所选兼岗</option>
              <option value="suspend" disabled={!members.some(member => member.canSuspend)}>停用账号</option>
              <option value="offboard" disabled={!members.some(member => member.canOffboard)}>办理离职</option>
            </select>
          </label>
          {operation === 'transfer' && <label className="text-sm">承接部门{' '}
            <select className={selectStyle} value={target?.id || ''} disabled={busy}
              onChange={event => { setTarget(departmentById.get(event.target.value) || null); setChoices({}); editSelection() }}>
              <option value="">请选择</option>
              {transferUnavailable && target && <option value={target.id} disabled>{target.name}（当前不可用）</option>}
              {allowedTargets.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </label>}
          {transferUnavailable && target && <p role="status" className="text-sm text-amber-800">
            已选承接部门「{target.name}」当前不可用。请重新选择，或在预览中核对这些转岗。
          </p>}
          {transferNeedsTarget && <p role="status" className="text-sm text-amber-800">请为已选员工选择承接部门，或取消转岗操作。</p>}
          {operation === 'transfer' && <p className="text-sm text-slate-600">转岗后不保留原主部门为兼岗。</p>}
          {operation === 'suspend' && <p className="text-sm text-slate-600">停用仅影响登录，关联部门仍需处置。</p>}
        </div>}
      </div>
      {result && renderResults(result, '上次处置结果')}
      {review && renderResults(review, '待确认处置方案')}
      {failure && <p role="alert" className="text-sm text-red-800">{failure}</p>}
      {cannotEditSelection && <p role="status" className="text-sm text-amber-800">当前权限已变化，请取消受限的归档或改挂选择后重新预览。</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={review ? 'outline' : 'default'} disabled={busy || !canPreview} onClick={() => void prepare()}>核对处置方案</Button>
        {review && rowsFor(review).some(row => row.status === 'ready') && <Button type="button" disabled={busy} onClick={() => void apply()}>确认应用可执行项</Button>}
      </div>
    </div>
  )
}

type ArchivedDepartment = {
  archiveId: string; departmentId: string; name: string; code: string | null; parentDepartmentId: string | null; archivedAt: string;
}
type LegacyInactive = { departmentId: string; name: string; source: string; code?: string | null; blockedReason?: string | null }
type ArchiveList = {
  archivedDepartments: ArchivedDepartment[];
  legacyInactive: LegacyInactive[];
  archiveHistory?: Array<ArchivedDepartment & { restoredAt: string | null }>;
}

const archiveTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short',
})

export function ArchivedDepartmentsPanel({
  orgId, departments, authHeaders, onRefresh, canRestore, onRestored, onOpenIntegrations,
}: Pick<Props, 'orgId' | 'departments' | 'authHeaders' | 'onRefresh' | 'onOpenIntegrations'> & {
  canRestore: boolean; onRestored: (id: string) => void;
}) {
  const heading = useId()
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [page, setPage] = useState<ArchiveList | null>(null)
  const [restore, setRestore] = useState<{ archived: ArchivedDepartment; parentId: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const [notice, setNotice] = useState('')
  const parents = new Map(departments.map(row => [row.id, row.parent_id]))
  const departmentsById = new Map(departments.map(row => [row.id, row]))
  const restoredHistory = page?.archiveHistory?.flatMap(row => row.restoredAt ? [{ ...row, restoredAt: row.restoredAt }] : []) ?? []

  useEffect(() => {
    const controller = new AbortController()
    void requestData<ArchiveList>(authHeaders, { query: new URLSearchParams({ query: search }), signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setPage(data) })
      .catch((error: unknown) => { if (!controller.signal.aborted) setFailure(textDetail(error)) })
    return () => controller.abort()
  }, [authHeaders, orgId, search, revision])

  function refresh() {
    setFailure('')
    setRevision(version => version + 1)
  }

  async function restoreDepartment() {
    if (!restore?.parentId || pending) return
    const { archived, parentId } = restore
    const parent = departmentsById.get(parentId)
    if (!parent || !availableTarget(parent, parents, new Set([archived.departmentId]))) return
    setPending(true)
    setFailure('')
    try {
      const confirmation = await confirmAction(`将「${archived.name}」恢复到「${parent.name}」下？已转移的成员和原授权不会恢复。`, {
        title: '确认恢复部门', confirmText: '恢复部门',
      })
      if (!confirmation) return
      const result = await requestData<{ departmentId: string; status: 'restored' | 'unchanged' }>(authHeaders, {
        body: { action: 'restore', expectedOrgId: orgId, departmentId: archived.departmentId, archiveId: archived.archiveId, parentDepartmentId: parentId },
      })
      if (result.departmentId !== archived.departmentId || !['restored', 'unchanged'].includes(result.status)) {
        throw new Error('未能核对该部门恢复的结果，请重新读取归档记录。')
      }
      setNotice(result.status === 'restored' ? `已恢复「${archived.name}」。` : `「${archived.name}」已处理。`)
      setRestore(null)
      onRestored(archived.departmentId)
      refresh()
      try { await onRefresh?.() } catch { setFailure('部门恢复结果已返回，组织架构暂未刷新。') }
    } catch (error) { setFailure(textDetail(error)) }
    finally { setPending(false) }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-white p-4" aria-labelledby={heading}>
      <h3 className="font-medium text-slate-900" id={heading}>已归档部门</h3>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
        event.preventDefault()
        setSearch(query.trim())
        refresh()
      }}>
        <label className="text-sm">搜索已归档部门<Input className="mt-1" value={query} maxLength={100}
          onChange={event => setQuery(event.target.value)} disabled={pending} /></label>
        <Button type="submit" variant="outline" disabled={pending}>搜索</Button>
      </form>
      {!page && !failure && <p role="status" className="text-sm text-slate-600">正在读取归档记录…</p>}
      {page?.archivedDepartments.length === 0 && <p className="text-sm text-slate-600">没有符合条件的归档部门。</p>}
      {page?.archivedDepartments.map(archived => (
        <details key={archived.archiveId} className="rounded border p-3 text-sm">
          <summary className="cursor-pointer">
            <strong>{archived.name}</strong> {archived.code && <span className="text-slate-600">· {archived.code}</span>}
          </summary>
          <div className="mt-2 space-y-2">
            <p>归档时间 {archiveTime.format(new Date(archived.archivedAt))}</p>
            {archived.parentDepartmentId && departmentsById.get(archived.parentDepartmentId)?.name && (
              <p>归档时的上级 {departmentsById.get(archived.parentDepartmentId)?.name}</p>
            )}
            <p className="text-slate-600">历史单据仍归原成员。恢复部门时只恢复部门本身。</p>
            {canRestore && restore?.archived.archiveId !== archived.archiveId && (
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setRestore({ archived, parentId: '' })}>
                恢复 {archived.name}
              </Button>
            )}
            {canRestore && restore?.archived.archiveId === archived.archiveId && <div className="flex flex-wrap items-end gap-2">
              <label>恢复到有效上级{' '}
                <select className={selectStyle} value={restore.parentId} disabled={pending}
                  onChange={event => setRestore({ archived, parentId: event.target.value })}>
                  <option value="">请选择</option>{departments.filter(row => availableTarget(row, parents, new Set([archived.departmentId])))
                    .map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </label>
              <Button type="button" size="sm" disabled={pending || !restore.parentId} onClick={() => void restoreDepartment()}>确认恢复</Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setRestore(null)}>取消恢复</Button>
            </div>}
          </div>
        </details>
      ))}
      {(page?.legacyInactive.length ?? 0) > 0 && (
        <div className="rounded border p-3 text-sm">
          <h4 className="font-medium">历史停用部门</h4>
          <ul className="mt-2 space-y-2">
            {page?.legacyInactive.map(row => <li key={row.departmentId}>{row.name} · {labelSource(row.source)}
              {row.blockedReason && <span> · {reasonFor(row.blockedReason)}</span>}
              {row.source !== 'manual' && onOpenIntegrations && <Button type="button" size="sm" variant="ghost" onClick={onOpenIntegrations}>前往外部系统接入</Button>}
            </li>)}
          </ul>
        </div>
      )}
      {restoredHistory.length > 0 && (
        <div className="rounded border p-3 text-sm">
          <h4 className="font-medium">已恢复的归档记录</h4>
          <ul className="mt-2 space-y-2">
            {restoredHistory.map(row => <li key={row.archiveId}>
              <strong>{row.name}</strong> {row.code && <span className="text-slate-600">· {row.code}</span>}
              <p className="text-slate-600">归档 {archiveTime.format(new Date(row.archivedAt))} · 恢复 {archiveTime.format(new Date(row.restoredAt))}</p>
            </li>)}
          </ul>
        </div>
      )}
      {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
      {failure && <div className="space-y-1"><p role="alert" className="text-sm text-red-800">{failure}</p>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={refresh}>重新读取归档记录</Button>
      </div>}
    </section>
  )
}
