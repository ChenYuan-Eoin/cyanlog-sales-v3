import { Building2Icon, UsersIcon } from 'lucide-react'
import type { DirectoryCutoverClientPlan } from '@/lib/organization-connections/directory-cutover'

export function directoryScopeUnverified(plan: Pick<DirectoryCutoverClientPlan, 'provider' | 'snapshot'>) {
  return plan.provider === 'fxiaoke' && (!plan.snapshot.scopeVerified
    || typeof plan.snapshot.scopeEvidence !== 'string' || !plan.snapshot.scopeEvidence.trim())
}

export type DirectoryOverview = {
  state: 'changes' | 'unchanged' | 'read_only' | 'failed'
  departmentsAdded: number
  departmentsRemoved: number
  membersAdded: number
  membersRemoved: number
  membersMoved: number
  membersLinked: number
  reviewCount: number
}

export function directoryOverview(plan: DirectoryCutoverClientPlan): DirectoryOverview {
  const { summary, snapshot } = plan
  const pending = plan.status === 'planned'
  const reviewCount = plan.status === 'rolled_back' ? 0 : summary.conflicts
  const hasDifferences = pending && (summary.departmentsAdded > 0 || summary.departmentsUpdated > 0
    || summary.departmentsToDeactivate > 0 || summary.identitiesAdded > 0 || summary.identitiesUpdated > 0
    || (summary.membersMoved ?? 0) > 0 || (summary.membersOffboarded ?? 0) > 0 || (summary.membersLinked ?? 0) > 0)
  const empty = { departmentsAdded: 0, departmentsRemoved: 0, membersAdded: 0, membersRemoved: 0, membersMoved: 0, membersLinked: 0, reviewCount: 0 }
  if (pending && (!snapshot.complete || !snapshot.connectionVerified)) return { ...empty, state: 'failed' }
  if (pending && directoryScopeUnverified(plan)) return { ...empty, state: 'read_only' }
  if (!hasDifferences && !reviewCount) return { ...empty, state: 'unchanged' }
  return {
    state: 'changes',
    departmentsAdded: pending ? summary.departmentsAdded : 0,
    departmentsRemoved: pending ? summary.departmentsToDeactivate : 0,
    membersAdded: pending ? summary.membersAdded ?? 0 : 0,
    membersRemoved: pending ? summary.membersOffboarded ?? 0 : 0,
    membersMoved: pending ? summary.membersMoved ?? 0 : 0,
    membersLinked: pending ? summary.membersLinked ?? 0 : 0,
    reviewCount,
  }
}

export function DirectoryChangeSummary({ overview, onOpen }: { overview: DirectoryOverview; onOpen?: () => void }) {
  const { state, departmentsAdded, departmentsRemoved, membersAdded, membersRemoved, membersMoved, membersLinked, reviewCount } = overview
  const className = 'inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded text-left text-xs text-slate-600'
  const content = state === 'failed' ? '检查失败'
    : state === 'read_only' ? '读取范围待核实'
    : state === 'unchanged' ? '无差异'
    : (
      <>
        {departmentsAdded + departmentsRemoved > 0 && <span className="inline-flex items-center gap-1">
          <Building2Icon size={13} aria-hidden="true" /><span className="sr-only">部门</span>
          {departmentsAdded > 0 && <span className="text-emerald-700">+{departmentsAdded}</span>}
          {departmentsRemoved > 0 && <span className="text-rose-700">−{departmentsRemoved}</span>}
        </span>}
        {membersAdded + membersRemoved > 0 && <span className="inline-flex items-center gap-1">
          <UsersIcon size={13} aria-hidden="true" /><span className="sr-only">在职成员</span>
          {membersAdded > 0 && <span className="text-emerald-700">+{membersAdded}</span>}
          {membersRemoved > 0 && <span className="text-rose-700">−{membersRemoved}</span>}
        </span>}
        {membersLinked > 0 && <span>关联 {membersLinked}</span>}
        {membersMoved > 0 && <span>调岗 {membersMoved}</span>}
        {reviewCount > 0 && <span className="text-amber-800">待核对 {reviewCount}</span>}
        {departmentsAdded + departmentsRemoved + membersAdded + membersRemoved + membersLinked + membersMoved + reviewCount === 0 && '查看资料与组织变更'}
      </>
    )
  return onOpen
    ? <button type="button" aria-haspopup="dialog" onClick={onOpen} className={`${className} hover:underline focus-visible:outline-2 focus-visible:outline-blue-600`}><span className="sr-only">查看纷享组织差异</span>{content}</button>
    : <span className={className}>{content}</span>
}
