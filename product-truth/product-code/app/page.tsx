'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HomeInitialAuthError, loadHomeInitialData } from '@/lib/home-data-client'
import { clearClientSession, logoutClientSession } from '@/lib/session-client'
import { normalizeSalesSpaceName } from '@/lib/scoped-access'
import type { DepartmentSpace } from '@/lib/department-spaces'

// 类型定义（与数据库 schema 对应）
interface SalesSpace {
  id: string
  name: string
  description: string | null
  department_id: string
  owner_id: string
  active_opportunities: number
  pending_milestones: number
}

interface Opportunity {
  id: string
  space_id: string
  customer_id: string
  name: string
  amount: number
  status: string
  stage: string | null
  probability: number
  owner_id: string
  expected_close_date: string | null
}

interface Customer {
  id: string
  name: string
  short_name: string | null
}

interface Milestone {
  id: string
  opportunity_id: string
  name: string
  type: string
  status: string
  priority: string
  due_date: string
  opportunity?: { name: string; customer_id: string }
}

interface Reminder {
  id: string
  type: string
  title: string
  description: string | null
  priority: string
  read_at: string | null
}

interface AgendaItem {
  id: string
  title: string
  description: string | null
  start_time: string
  end_time: string | null
}

interface Profile {
  id: string
  display_name: string
  email: string
  title: string | null
  primary_dept_id: string
  org_id?: string | null
  canManageOrg?: boolean
  roles: { code: string; name: string }[]
  spaces: SalesSpace[]
}

interface DashboardPayload {
  spaces: SalesSpace[]
  activeSpace: SalesSpace | null
  opportunities: (Opportunity & { customer?: Customer })[]
  milestones: Milestone[]
  reminders: Reminder[]
  agenda: AgendaItem[]
}

type DepartmentSelection = {
  departmentId: string | null
  includeSubdepartments: boolean
}

type DepartmentDashboardPayload = Pick<DashboardPayload, 'opportunities' | 'milestones'> & {
  departmentSpaces: DepartmentSpace[]
  selection: DepartmentSelection
}

type DepartmentRosterPayload = {
  status: 'ready'
  asOf: string
  total: number
  page: number
  pageSize: number
  members: Array<{ id: string; displayName: string; departmentIds: string[] }>
}

const DEPARTMENT_SUMMARY: DepartmentSelection = { departmentId: null, includeSubdepartments: true }

class DepartmentMembershipError extends Error {}

function departmentPreferenceKey(profile: Profile) {
  return `dashboard:department:${profile.id}:${profile.org_id ?? ''}`
}

function readDepartmentPreference(profile: Profile): DepartmentSelection | null {
  try {
    const saved = sessionStorage.getItem(departmentPreferenceKey(profile))
    if (!saved) return null
    const [departmentId, scope] = saved.split(':')
    return { departmentId: departmentId || null, includeSubdepartments: scope !== 'direct' }
  } catch {
    return null
  }
}

function saveDepartmentPreference(profile: Profile, selection: DepartmentSelection) {
  const key = departmentPreferenceKey(profile)
  try {
    sessionStorage.setItem(key, `${selection.departmentId ?? ''}:${selection.includeSubdepartments ? 'subtree' : 'direct'}`)
  } catch {
    // The current selection remains usable when the browser blocks storage.
  }
}

async function fetchDepartmentDashboard(
  selection: DepartmentSelection,
  token: string | null,
  signal: AbortSignal,
): Promise<DepartmentDashboardPayload | null> {
  const params = departmentQuery(selection)
  const query = params.size ? `?${params}` : ''
  const response = await fetch(`/api/dashboard/department${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
    signal,
  })
  if (response.status === 401) throw new HomeInitialAuthError()
  if (response.status === 403) {
    const result = await response.json().catch(() => null)
    if (result?.code === 'DEPARTMENT_SCOPE_REQUIRED' || result?.code === 'DEPARTMENT_SELECTION_FORBIDDEN') return null
    throw new DepartmentMembershipError()
  }
  if (!response.ok) throw new Error('Unable to load department dashboard')
  return response.json()
}

function departmentQuery(selection: DepartmentSelection) {
  const params = new URLSearchParams()
  if (selection.departmentId) {
    params.set('departmentId', selection.departmentId)
    params.set('includeSubdepartments', String(selection.includeSubdepartments))
  }
  return params
}

function departmentOptionLabel(space: DepartmentSpace, byId: Map<string, DepartmentSpace>) {
  const names = [space.name]
  const seen = new Set([space.department_id])
  let parentId = space.parent_department_id
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId)
    if (!parent) break
    names.unshift(parent.name)
    seen.add(parentId)
    parentId = parent.parent_department_id
  }
  return names.join(' / ')
}

function DepartmentRoster({
  selection, departments,
}: {
  selection: DepartmentSelection
  departments: Map<string, DepartmentSpace>
}) {
  const [page, setPage] = useState(1)
  const [state, setState] = useState<'loading' | 'unavailable' | DepartmentRosterPayload>('loading')
  const { departmentId, includeSubdepartments } = selection

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const query = departmentQuery({ departmentId, includeSubdepartments })
    query.set('page', String(page))
    const token = localStorage.getItem('token')
    void fetch(`/api/dashboard/department/roster?${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
      signal,
    }).then(async response => {
      const result = response.ok ? await response.json() : null
      if (!signal.aborted) setState(result?.status === 'ready' ? result : 'unavailable')
    }).catch(() => {
      if (!signal.aborted) setState('unavailable')
    })
    return () => controller.abort()
  }, [departmentId, includeSubdepartments, page])

  function goToPage(nextPage: number) {
    setState('loading')
    setPage(nextPage)
  }

  return (
    <section className="side-card mt-6" aria-label="同步在职名单" aria-busy={state === 'loading'}>
      <div className="side-card-header">
        同步在职
        {typeof state !== 'string' && <span className="stat-tag">{state.total} 人</span>}
      </div>
      {state === 'loading' && <div className="empty-mini" role="status">正在读取同步在职名单</div>}
      {state === 'unavailable' && <div className="empty-mini" role="status">暂时无法核对同步名单</div>}
      {typeof state !== 'string' && (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {new Intl.DateTimeFormat('zh-CN', {
              timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
            }).format(new Date(state.asOf))} 同步
          </p>
          {state.members.length === 0 ? <div className="empty-mini">当前范围暂无同步在职成员</div> : (
            <ul className="divide-y divide-slate-100">
              {state.members.map(member => (
                <li className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm" key={member.id}>
                  <span className="font-medium text-slate-900">{member.displayName}</span>
                  <span className="text-xs text-slate-500">
                    {member.departmentIds.map(id => departments.get(id)?.name).filter(Boolean).join('、')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {state.total > state.pageSize && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
              <button type="button" disabled={state.page <= 1} onClick={() => goToPage(state.page - 1)}
                className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50">上一页</button>
              <span>第 {state.page} 页</span>
              <button type="button" disabled={state.page * state.pageSize >= state.total} onClick={() => goToPage(state.page + 1)}
                className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50">下一页</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

const STATUS_MAP: Record<string, { label: string; pillClass: string }> = {
  LEAD: { label: '线索', pillClass: 'pill outline' },
  QUALIFIED: { label: '已验证', pillClass: 'pill info' },
  QUOTING: { label: '报价中', pillClass: 'pill warning' },
  CONTRACTING: { label: '合同中', pillClass: 'pill warning' },
  WON: { label: '已签约', pillClass: 'pill success' },
  LOST: { label: '已失败', pillClass: 'pill danger' },
  IN_PROGRESS: { label: '进行中', pillClass: 'pill info' },
  PENDING: { label: '待开始', pillClass: 'pill outline' },
  DONE: { label: '已完成', pillClass: 'pill success' },
  BLOCKED: { label: '阻塞', pillClass: 'pill danger' },
  OVERDUE: { label: '已逾期', pillClass: 'pill danger' },
  CRITICAL: { label: '紧急', pillClass: 'pill danger' },
  HIGH: { label: '高', pillClass: 'pill warning' },
  NORMAL: { label: '中', pillClass: 'pill outline' },
  LOW: { label: '低', pillClass: 'pill outline' },
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isFetchFailedError(error: unknown) {
  return error instanceof TypeError && error.message === 'Failed to fetch'
}

export default function HomePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [activeSpace, setActiveSpace] = useState<SalesSpace | null>(null)
  const [legacyOpportunities, setLegacyOpportunities] = useState<DashboardPayload['opportunities']>([])
  const [legacyMilestones, setLegacyMilestones] = useState<Milestone[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [agenda, setAgenda] = useState<AgendaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [todayLabel, setTodayLabel] = useState('今天')
  const [departmentDashboard, setDepartmentDashboard] = useState<DepartmentDashboardPayload | null>(null)
  const [departmentUnavailable, setDepartmentUnavailable] = useState(false)
  const [pendingDepartment, setPendingDepartment] = useState<DepartmentSelection | null>(null)
  const [scopeError, setScopeError] = useState('')
  const departmentRequest = useRef<AbortController | null>(null)

  const applyDepartmentDashboard = useCallback((payload: DepartmentDashboardPayload, currentProfile: Profile) => {
    setDepartmentDashboard(payload)
    setDepartmentUnavailable(false)
    saveDepartmentPreference(currentProfile, payload.selection)
  }, [])

  const applyPersonalDashboard = useCallback((data?: Pick<DashboardPayload, 'reminders' | 'agenda'>) => {
    setAgenda(data?.agenda || [])
    setReminders(data?.reminders || [])
  }, [])

  const applyDashboardPayload = useCallback((data: DashboardPayload, nextProfile?: Profile) => {
    const normalizedSpaces = (data.spaces || []).map((space) => ({
      ...space,
      name: normalizeSalesSpaceName(space.name),
    }))
    const normalizedActiveSpace = data.activeSpace
      ? {
          ...data.activeSpace,
          name: normalizeSalesSpaceName(data.activeSpace.name),
        }
      : null

    if (nextProfile) {
      setProfile({
        ...nextProfile,
        roles: nextProfile.roles || [],
        spaces: normalizedSpaces,
      })
    } else {
      setProfile(prev => prev ? { ...prev, spaces: normalizedSpaces } : null)
    }
    setActiveSpace(normalizedActiveSpace)
    setLegacyOpportunities(data.opportunities || [])
    setLegacyMilestones(data.milestones || [])
    applyPersonalDashboard(data)
  }, [applyPersonalDashboard])

  // 加载全部数据
  const switchSpace = useCallback(async (spaceId: string) => {
    if (loading || spaceId === activeSpace?.id) return
    setScopeError('')
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/dashboard?spaceId=${encodeURIComponent(spaceId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        if (res.status === 401) {
          clearClientSession()
          router.push('/login')
          return
        }
        throw new Error('Dashboard load failed')
      }

      const data = await res.json() as DashboardPayload
      if (data.activeSpace?.id !== spaceId) throw new Error('Sales space is no longer available')
      applyDashboardPayload(data)
    } catch (e) {
      console.error('[Dashboard] load error', e)
      setScopeError('无法切换销售空间。请重试。')
    } finally {
      setLoading(false)
    }
  }, [activeSpace?.id, applyDashboardPayload, loading, router])

  useEffect(() => {
    let mounted = true
    const controller = new AbortController()
    ;(async () => {
      const token = localStorage.getItem('token')
      const initialData = await loadHomeInitialData(token, { signal: controller.signal, view: 'personal' })
      const profileRow = initialData.profile as Profile | undefined
      const dashboardPayload = initialData.dashboard as DashboardPayload

      if (!mounted) return
      if (profileRow) {
        applyDashboardPayload(dashboardPayload, profileRow)

        const preferred = readDepartmentPreference(profileRow)
        try {
          let scoped = await fetchDepartmentDashboard(preferred ?? DEPARTMENT_SUMMARY, token, controller.signal)
          if (!scoped && preferred?.departmentId) {
            scoped = await fetchDepartmentDashboard(DEPARTMENT_SUMMARY, token, controller.signal)
            if (mounted && scoped) setScopeError('上次查看的部门已不可用，已显示授权范围汇总。')
          }
          if (!mounted) return
          if (scoped) {
            applyDepartmentDashboard(scoped, profileRow)
          } else if (preferred) {
            setDepartmentUnavailable(true)
            setScopeError('上次使用的部门空间已不可访问。')
          } else {
            const legacy = await fetch('/api/dashboard', {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
              cache: 'no-store',
              signal: controller.signal,
            })
            if (!mounted) return
            if (legacy.status === 401) throw new HomeInitialAuthError()
            if (!legacy.ok) throw new Error('Unable to load sales dashboard')
            const legacyDashboard: DashboardPayload = await legacy.json()
            if (mounted) applyDashboardPayload(legacyDashboard)
          }
        } catch (error) {
          if (!mounted || isAbortError(error) || error instanceof HomeInitialAuthError) throw error
          setDepartmentUnavailable(true)
          if (error instanceof DepartmentMembershipError) applyPersonalDashboard()
          setScopeError(error instanceof DepartmentMembershipError
            ? '当前组织成员权限已变化，请重新加载。'
            : '暂时无法验证部门空间。请重试。')
        }
      }
      setLoading(false)
    })().catch((error) => {
      if (!mounted || isAbortError(error)) {
        return
      }
      if (error instanceof HomeInitialAuthError) {
        clearClientSession()
        router.push('/login')
        setLoading(false)
        return
      }
      if (isFetchFailedError(error)) {
        window.setTimeout(() => {
          if (!mounted || controller.signal.aborted) {
            return
          }
          console.error('[Dashboard] initial load error', error)
          setLoading(false)
        }, 100)
        return
      }
      console.error('[Dashboard] initial load error', error)
      setLoading(false)
    })
    return () => {
      mounted = false
      controller.abort()
      departmentRequest.current?.abort()
    }
  }, [applyDashboardPayload, applyDepartmentDashboard, applyPersonalDashboard, router])

  const switchDepartment = useCallback(async (selection: DepartmentSelection) => {
    if (!profile) return
    departmentRequest.current?.abort()
    const controller = new AbortController()
    departmentRequest.current = controller
    setPendingDepartment(selection)
    setScopeError('')
    try {
      const token = localStorage.getItem('token')
      const payload = await fetchDepartmentDashboard(selection, token, controller.signal)
      if (controller.signal.aborted) return
      if (payload) {
        applyDepartmentDashboard(payload, profile)
        return
      }
      setDepartmentDashboard(null)
      setDepartmentUnavailable(true)
      setScopeError('该部门空间已不可访问，请重新加载授权范围。')
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof HomeInitialAuthError) {
        setDepartmentDashboard(null)
        setDepartmentUnavailable(true)
        clearClientSession()
        router.push('/login')
        return
      }
      if (error instanceof DepartmentMembershipError) {
        applyPersonalDashboard()
        setDepartmentDashboard(null)
        setDepartmentUnavailable(true)
        setScopeError('当前组织成员权限已变化，请重新加载。')
        return
      }
      setScopeError('暂时无法切换部门空间。请重试。')
    } finally {
      if (departmentRequest.current === controller) {
        departmentRequest.current = null
        setPendingDepartment(null)
      }
    }
  }, [applyDepartmentDashboard, applyPersonalDashboard, profile, router])

  const departmentById = new Map((departmentDashboard?.departmentSpaces ?? []).map(space => [space.department_id, space]))
  const selection = departmentDashboard?.selection
  const shownSelection = pendingDepartment ?? selection
  const selectedDepartment = selection?.departmentId ? departmentById.get(selection.departmentId) : undefined
  const currentView = departmentDashboard
    ? selectedDepartment
      ? `${selectedDepartment.name}（${selection?.includeSubdepartments ? '含下级部门' : '仅本部门'}）`
      : '授权范围汇总'
    : departmentUnavailable ? '部门空间暂不可用' : loading ? undefined : activeSpace?.name
  const opportunities = departmentDashboard?.opportunities ?? (departmentUnavailable ? [] : legacyOpportunities)
  const milestones = departmentDashboard?.milestones ?? (departmentUnavailable ? [] : legacyMilestones)

  // 统计计算
  const stats = {
    activeOpportunities: opportunities.filter(o => ['LEAD', 'QUALIFIED', 'QUOTING', 'CONTRACTING'].includes(o.status)).length,
    todayNodes: milestones.filter(m => {
      if (!m.due_date) return false
      const d = new Date(m.due_date)
      const today = new Date()
      return d.toDateString() === today.toDateString()
    }).length,
    pendingApproval: milestones.filter(m => m.type === 'REVIEW' && m.status === 'PENDING').length,
    monthlyContracts: opportunities.filter(o => {
      if (o.status !== 'WON' || !o.expected_close_date) return false
      const d = new Date(o.expected_close_date)
      const now = new Date()
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    }).length,
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  useEffect(() => {
    setTodayLabel(new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(new Date()))
  }, [])

  return (
    <div className="content-area" style={{ maxWidth: 1440, margin: '0 auto' }}>
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="breadcrumb">
            <span className="breadcrumb-current">首页</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">销售工作台</h1>
          <p className="subtitle max-w-3xl">
            {profile
              ? `${profile.display_name}${currentView ? `，当前视图 ${currentView}` : ''}。`
              : '加载中...'}
          </p>
        </div>

        <div className="grid gap-3 xl:min-w-[360px]">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              placeholder="搜索机会、客户、节点"
            />
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">⌘K</span>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">{profile?.display_name || '...'}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {profile?.roles?.[0]?.name || profile?.title || '销售'} · {todayLabel}
                </div>
                {!departmentDashboard && currentView && <div className="mt-2 text-xs text-slate-500">{currentView}</div>}
              </div>

              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                {(profile?.display_name || '?').charAt(0)}
              </div>
            </div>

            {departmentDashboard && shownSelection && (
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" aria-busy={Boolean(pendingDepartment)}>
                <label className="grid min-w-0 gap-1 text-xs font-medium text-slate-600">
                  当前部门空间
                  <select
                    value={shownSelection.departmentId ?? ''}
                    onChange={event => {
                      const departmentId = event.target.value
                      void switchDepartment(departmentId
                        ? { departmentId, includeSubdepartments: shownSelection.includeSubdepartments }
                        : DEPARTMENT_SUMMARY)
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="">授权范围汇总</option>
                    {departmentDashboard.departmentSpaces.map(space => (
                      <option key={space.department_id} value={space.department_id}>
                        {departmentOptionLabel(space, departmentById)}
                      </option>
                    ))}
                  </select>
                </label>
                {shownSelection.departmentId && (
                  <label className="grid gap-1 text-xs font-medium text-slate-600">
                    部门数据范围
                    <select
                      value={shownSelection.includeSubdepartments ? 'subtree' : 'direct'}
                      onChange={event => void switchDepartment({
                        ...shownSelection, includeSubdepartments: event.target.value === 'subtree',
                      })}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      <option value="direct">仅本部门</option>
                      <option value="subtree">含下级部门</option>
                    </select>
                  </label>
                )}
              </div>
            )}
            {pendingDepartment && <p className="mt-2 text-xs text-slate-500" role="status">正在切换部门空间</p>}
            {scopeError && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-800">
                <p role="alert">{scopeError}</p>
                {departmentUnavailable && (
                  <button type="button" className="underline" disabled={Boolean(pendingDepartment)}
                    onClick={() => void switchDepartment(DEPARTMENT_SUMMARY)}>
                    重新加载部门空间
                  </button>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {profile?.canManageOrg && (
                <Link
                  href="/configs"
                  prefetch={false}
                  className="inline-flex h-10 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  配置中心
                </Link>
              )}
              <button
                onClick={async () => {
                  await logoutClientSession()
                  router.replace('/login')
                }}
                className="inline-flex h-10 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      </div>

      {!departmentDashboard && !departmentUnavailable && !loading && (activeSpace || (profile?.spaces?.length ?? 0) > 1) && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">{activeSpace?.name || '销售空间'}</div>
              <div className="mt-1 text-sm text-slate-500">
                {activeSpace
                  ? `${activeSpace.active_opportunities ?? stats.activeOpportunities} 个活跃机会 · ${activeSpace.pending_milestones ?? stats.todayNodes} 个硬节点`
                  : '选择一个销售空间后，首页会切换到对应业务视图。'}
              </div>
            </div>

            {profile?.spaces && profile.spaces.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {profile.spaces.map((sp) => {
                  const isActive = sp.id === activeSpace?.id
                  return (
                    <button
                      key={sp.id}
                      aria-pressed={isActive}
                      onClick={() => void switchSpace(sp.id)}
                      className={`inline-flex items-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {sp.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">活跃机会</span>
            <span className="stat-tag">{departmentDashboard ? '当前列表' : '总览'}</span>
          </div>
          {loading ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (
            <div className="stat-card-value">{stats.activeOpportunities}</div>
          )}
          <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>本空间</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">今日硬节点</span>
            <span className="stat-tag warning">{stats.todayNodes}</span>
          </div>
          {loading ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (
            <div className="stat-card-value">{stats.todayNodes} <span style={{ fontSize: 'var(--text-h3)' }}>个</span></div>
          )}
          <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>{departmentDashboard ? '当前列表' : '需跨角色协同'}</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">待审批</span>
            <span className="stat-tag info">{stats.pendingApproval}</span>
          </div>
          {loading ? <div className="skeleton" style={{ width: 80, height: 32 }} /> : (
            <div className="stat-card-value" style={{ fontSize: '28px' }}>{stats.pendingApproval} 项</div>
          )}
          <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>{departmentDashboard ? '当前列表' : '在审'}</div>
        </div>

        {!departmentDashboard && !departmentUnavailable && <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">本月已签约</span>
            <span className="stat-tag success">{stats.monthlyContracts}</span>
          </div>
          {loading ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (
            <div className="stat-card-value">{stats.monthlyContracts}</div>
          )}
          <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>单</div>
        </div>}
      </div>

      <div className="content-grid">
        <div className="hero-card">
          <div className="eyebrow">{currentView || '销售空间'}</div>
          <h2>今日优先队列</h2>
          <p>优先处理下列项目与动作。每一项都还差一个明确节点。</p>

          <div className="queue-grid">
            {loading ? (
              <><div className="skeleton queue-card" /><div className="skeleton queue-card" /><div className="skeleton queue-card" /></>
            ) : opportunities.length === 0 ? (
              <div className="empty-state">
                <p>{departmentUnavailable ? '部门范围待重新验证' : '本空间暂无活跃机会'}</p>
              </div>
            ) : (
              opportunities.slice(0, 3).map(o => (
                <Link key={o.id} href={`/opportunities/${encodeURIComponent(o.id)}`} prefetch={false} className="queue-card">
                  <div className="queue-card-title">{o.name}</div>
                  <div className="queue-card-meta">
                    <span className={STATUS_MAP[o.status]?.pillClass || 'pill'}>
                      {STATUS_MAP[o.status]?.label || o.status}
                    </span>
                    {' · '}
                    {o.customer?.short_name || o.customer?.name || ''}
                    {o.expected_close_date && ` · 截止 ${o.expected_close_date}`}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="side-panel">
          <div className="side-card">
            <div className="side-card-header">今日安排</div>
            {loading ? (
              <div className="skeleton" style={{ height: 120 }} />
            ) : agenda.length === 0 ? (
              <div className="empty-mini">今日无安排</div>
            ) : agenda.map(item => (
              <div key={item.id} className="agenda-item">
                <div className="agenda-time">{formatTime(item.start_time)}</div>
                <div className="agenda-content">
                  <p>{item.title}</p>
                  <span>{item.description || ''}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="side-card">
            <div className="side-card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>今日提醒</span>
              <span className="stat-tag danger">{reminders.length}</span>
            </div>
            {loading ? (
              <div className="skeleton" style={{ height: 100 }} />
            ) : reminders.length === 0 ? (
              <div className="empty-mini">没有未读提醒</div>
            ) : reminders.map(r => (
              <div key={r.id} className="agenda-item">
                <span className={STATUS_MAP[r.priority]?.pillClass || 'pill outline'}>
                  {STATUS_MAP[r.priority]?.label || r.priority}
                </span>
                <div className="agenda-content" style={{ marginLeft: 12 }}>
                  <p>{r.title}</p>
                  {r.description && <span>{r.description}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!loading && milestones.length > 0 && (
        <div className="side-card" style={{ marginTop: 24 }}>
          <div className="side-card-header">硬节点时间线（7 天内）</div>
          {milestones.map(m => (
            <div key={m.id} className="agenda-item">
              <div className="agenda-time">
                {new Date(m.due_date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
              </div>
              <div className="agenda-content">
                <p>
                  {m.opportunity?.name} · {m.name}
                </p>
                <span>
                  <span className={STATUS_MAP[m.status]?.pillClass || 'pill'}>
                    {STATUS_MAP[m.status]?.label || m.status}
                  </span>
                  {' · '}
                  <span className={STATUS_MAP[m.priority]?.pillClass || 'pill outline'}>
                    {STATUS_MAP[m.priority]?.label || m.priority}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && selection && (
        <DepartmentRoster key={`${selection.departmentId ?? ''}:${selection.includeSubdepartments}`}
          selection={selection} departments={departmentById} />
      )}
    </div>
  )
}
