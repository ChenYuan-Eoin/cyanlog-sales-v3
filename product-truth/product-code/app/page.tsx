'use client'

import { useEffect, useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { scheduleCorePageWarmup } from '@/lib/core-page-warmup'
import { HomeInitialAuthError, loadHomeInitialData } from '@/lib/home-data-client'
import { clearClientSession, logoutClientSession } from '@/lib/session-client'
import { normalizeSalesSpaceName } from '@/lib/scoped-access'

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

export default function HomePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [activeSpace, setActiveSpace] = useState<SalesSpace | null>(null)
  const [opportunities, setOpportunities] = useState<(Opportunity & { customer?: Customer })[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [agenda, setAgenda] = useState<AgendaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [todayLabel, setTodayLabel] = useState('今天')

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
    setOpportunities(data.opportunities || [])
    setMilestones(data.milestones || [])
    setReminders(data.reminders || [])
    setAgenda(data.agenda || [])
  }, [])

  // 加载全部数据
  const load = useCallback(async (spaceId?: string) => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const url = spaceId ? `/api/dashboard?spaceId=${encodeURIComponent(spaceId)}` : '/api/dashboard'
      const res = await fetch(url, {
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
      applyDashboardPayload(data)
    } catch (e) {
      console.error('[Dashboard] load error', e)
    } finally {
      setLoading(false)
    }
  }, [applyDashboardPayload, router])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const token = localStorage.getItem('token')
      if (!token) {
        router.push('/login')
        setLoading(false)
        return
      }

      const initialData = await loadHomeInitialData(token)
      const profileRow = initialData.profile as Profile | undefined
      const dashboardPayload = initialData.dashboard as DashboardPayload

      if (mounted && profileRow) {
        applyDashboardPayload(dashboardPayload, profileRow)
        setLoading(false)
      } else {
        setLoading(false)
      }
    })().catch((error) => {
      if (error instanceof HomeInitialAuthError) {
        clearClientSession()
        router.push('/login')
        if (mounted) setLoading(false)
        return
      }
      console.error('[Dashboard] initial load error', error)
      if (mounted) setLoading(false)
    })
    return () => { mounted = false }
  }, [applyDashboardPayload, router])

  useEffect(() => {
    if (loading || !profile) return
    const token = localStorage.getItem('token')
    scheduleCorePageWarmup(token, (href) => router.prefetch(href))
  }, [loading, profile, router])

  // 切换销售空间
  const switchSpace = useCallback(async (spaceId: string) => {
    const sp = profile?.spaces.find(s => s.id === spaceId)
    if (!sp || !profile) return
    setActiveSpace(sp)
    void load(spaceId)
  }, [load, profile])

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
              ? `${profile.display_name}，${activeSpace?.name || '请选择一个销售空间'}。今天要处理的项目、待办和切换入口都在这里。`
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
                <div className="mt-2 text-xs text-slate-500">
                  {activeSpace?.name || '尚未选定销售空间'}
                </div>
              </div>

              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                {(profile?.display_name || '?').charAt(0)}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href="/configs"
                prefetch={false}
                className="inline-flex h-10 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                配置中心
              </Link>
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

      {(activeSpace || (profile?.spaces?.length ?? 0) > 1) && (
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
                      onClick={() => switchSpace(sp.id)}
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
            <span className="stat-tag">总览</span>
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
          <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>需跨角色协同</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">待审批</span>
            <span className="stat-tag info">{stats.pendingApproval}</span>
          </div>
          {loading ? <div className="skeleton" style={{ width: 80, height: 32 }} /> : (
            <div className="stat-card-value" style={{ fontSize: '28px' }}>{stats.pendingApproval} 项</div>
          )}
          <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>在审</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">本月已签约</span>
            <span className="stat-tag success">{stats.monthlyContracts}</span>
          </div>
          {loading ? <div className="skeleton" style={{ width: 60, height: 32 }} /> : (
            <div className="stat-card-value">{stats.monthlyContracts}</div>
          )}
          <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>单</div>
        </div>
      </div>

      <div className="content-grid">
        <div className="hero-card">
          <div className="eyebrow">{activeSpace?.name || '销售空间'}</div>
          <h2>今日优先队列</h2>
          <p>优先处理下列项目与动作。每一项都还差一个明确节点。</p>

          <div className="queue-grid">
            {loading ? (
              <><div className="skeleton queue-card" /><div className="skeleton queue-card" /><div className="skeleton queue-card" /></>
            ) : opportunities.length === 0 ? (
              <div className="empty-state">
                <p>本空间暂无活跃机会</p>
              </div>
            ) : (
              opportunities.slice(0, 3).map(o => (
                <Link key={o.id} href={`/opportunities/${o.id}`} prefetch={false} className="queue-card">
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

      {milestones.length > 0 && (
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
    </div>
  )
}
