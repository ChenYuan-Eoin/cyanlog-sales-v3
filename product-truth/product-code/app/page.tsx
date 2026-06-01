'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

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
  roles: { code: string; name: string }[]
  spaces: SalesSpace[]
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
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // 加载全部数据
  const load = useCallback(async (userId: string) => {
    setLoading(true)
    try {
      // 1. 用户空间
      const { data: spaceMembers } = await supabase
        .from('sales_space_members')
        .select('space:sales_spaces(*)')
        .eq('user_id', userId)

      const spaces: SalesSpace[] = (spaceMembers || [])
        .map((m: { space: SalesSpace | SalesSpace[] }) => Array.isArray(m.space) ? m.space[0] : m.space)
        .filter((s): s is SalesSpace => Boolean(s))

      if (spaces.length === 0) {
        setProfile(prev => prev ? { ...prev, spaces: [] } : null)
        setActiveSpace(null)
        setOpportunities([])
        setMilestones([])
        return
      }

      // 默认第一个空间
      const currentSpace = spaces[0]
      setActiveSpace(currentSpace)

      // 2. 空间内机会
      const { data: opps } = await supabase
        .from('opportunities')
        .select('*, customer:customers(id, name, short_name)')
        .eq('space_id', currentSpace.id)
        .order('expected_close_date', { ascending: true })
        .limit(20)

      const oppsData = (opps || []).map((o: Opportunity & { customer: Customer | Customer[] }) => ({
        ...o,
        customer: Array.isArray(o.customer) ? o.customer[0] : o.customer,
      }))
      setOpportunities(oppsData)

      // 3. 空间内节点的硬节点（今日到期）
      const today = new Date()
      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
      const { data: mls } = await supabase
        .from('milestones')
        .select('*, opportunity:opportunities(name, customer_id)')
        .in('opportunity_id', oppsData.map(o => o.id))
        .in('status', ['PENDING', 'IN_PROGRESS'])
        .lte('due_date', nextWeek.toISOString())
        .order('due_date', { ascending: true })
        .limit(10)

      setMilestones((mls || []).map((m: Milestone & { opportunity: { name: string; customer_id: string } | { name: string; customer_id: string }[] }) => ({
        ...m,
        opportunity: Array.isArray(m.opportunity) ? m.opportunity[0] : m.opportunity,
      })))

      // 4. 当前用户提醒
      const { data: rems } = await supabase
        .from('reminders')
        .select('*')
        .eq('user_id', userId)
        .is('dismissed_at', null)
        .order('created_at', { ascending: false })
        .limit(5)

      setReminders(rems || [])

      // 5. 今日日程
      const todayStr = today.toISOString().slice(0, 10)
      const { data: ag } = await supabase
        .from('agenda_items')
        .select('*')
        .eq('user_id', userId)
        .eq('agenda_date', todayStr)
        .order('start_time', { ascending: true })
        .limit(6)

      setAgenda(ag || [])

      // 6. 设置 profile 的 spaces
      setProfile(prev => prev ? { ...prev, spaces } : null)
    } catch (e) {
      console.error('[Dashboard] load error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      // 读 profile + roles
      const { data: profileRow } = await supabase
        .from('users')
        .select('id, display_name, email, title, primary_dept_id, user_roles(role:roles(code, name))')
        .eq('id', user.id)
        .single()

      if (mounted && profileRow) {
        const roles = (profileRow.user_roles || []).map((r: { role: { code: string; name: string } | { code: string; name: string }[] }) =>
          Array.isArray(r.role) ? r.role[0] : r.role
        ).filter(Boolean)
        setProfile({ ...profileRow, roles, spaces: [] })
        await load(user.id)
      } else {
        setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [router, load])

  // 切换销售空间
  const switchSpace = useCallback(async (spaceId: string) => {
    const sp = profile?.spaces.find(s => s.id === spaceId)
    if (!sp || !profile) return
    setActiveSpace(sp)
    setLoading(true)
    const { data: opps } = await supabase
      .from('opportunities')
      .select('*, customer:customers(id, name, short_name)')
      .eq('space_id', spaceId)
      .order('expected_close_date', { ascending: true })
      .limit(20)
    const oppsData = (opps || []).map((o: Opportunity & { customer: Customer | Customer[] }) => ({
      ...o,
      customer: Array.isArray(o.customer) ? o.customer[0] : o.customer,
    }))
    setOpportunities(oppsData)

    if (oppsData.length > 0) {
      const { data: mls } = await supabase
        .from('milestones')
        .select('*, opportunity:opportunities(name, customer_id)')
        .in('opportunity_id', oppsData.map(o => o.id))
        .in('status', ['PENDING', 'IN_PROGRESS'])
        .order('due_date', { ascending: true })
        .limit(10)
      setMilestones((mls || []).map((m: Milestone & { opportunity: { name: string; customer_id: string } | { name: string; customer_id: string }[] }) => ({
        ...m,
        opportunity: Array.isArray(m.opportunity) ? m.opportunity[0] : m.opportunity,
      })))
    } else {
      setMilestones([])
    }
    setLoading(false)
  }, [profile])

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

  return (
    <div className="dashboard-shell">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <div className="rail">
        <div className="rail-logo">CY</div>
        <nav className="rail-nav">
          <Link href="/" className="active" title="首页">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
            </svg>
          </Link>
          <Link href="/quotes" title="报价">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v20M2 12h20" />
            </svg>
          </Link>
          <Link href="/contracts" title="合同">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </Link>
          <Link href="/configs" title="配置">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v6m0 6v6" />
            </svg>
          </Link>
          {profile?.roles.some(r => r.code === 'ADMIN' || r.code === 'SUPER_ADMIN') && (
            <Link href="/admin/org" title="组织管理" style={{ marginTop: 'auto' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </Link>
          )}
        </nav>
      </div>

      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Cyanlog</h2>
          <p>销售支撑平台</p>
        </div>

        {activeSpace && (
          <div className="workspace-card">
            <div className="workspace-name">{activeSpace.name}</div>
            <div className="workspace-meta">
              {activeSpace.active_opportunities ?? stats.activeOpportunities} 个活跃机会 ·{' '}
              {activeSpace.pending_milestones ?? stats.todayNodes} 个硬节点
            </div>
            <div style={{ marginTop: 8, textAlign: 'right' }}>
              <span className="workspace-tag">ONES</span>
            </div>
          </div>
        )}

        {profile?.spaces && profile.spaces.length > 1 && (
          <div className="nav-section">
            <div className="nav-section-title">切换空间</div>
            {profile.spaces.map(sp => (
              <button
                key={sp.id}
                onClick={() => switchSpace(sp.id)}
                className={`nav-link ${sp.id === activeSpace?.id ? 'active' : ''}`}
                style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer' }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sp.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="nav-section">
          <div className="nav-section-title">用户旅程</div>
          <Link href="/" className="nav-link active"><span>首页</span></Link>
          <Link href="/opportunities" className="nav-link"><span>机会</span></Link>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">协同</div>
          <Link href="/quotes" className="nav-link"><span>报价</span></Link>
          <Link href="/contracts" className="nav-link"><span>合同</span></Link>
        </div>

        <div className="nav-section" style={{ marginTop: 'auto' }}>
          <div className="nav-section-title">系统</div>
          <Link href="/configs" className="nav-link"><span>配置中心</span></Link>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <button className="mobile-toggle" onClick={() => setSidebarOpen(true)} aria-label="打开菜单">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="search-shell">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input placeholder="搜索机会、客户、节点" />
            <span className="kbd">⌘K</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 'var(--text-body-sm)', fontWeight: 500 }}>
                {profile?.display_name || '...'}
              </div>
              <div style={{ fontSize: 'var(--text-caption)', color: 'var(--fg-3)' }}>
                {profile?.roles?.[0]?.name || profile?.title || '销售'}
              </div>
            </div>
            <div className="avatar brand" style={{ width: 36, height: 36, fontSize: 'var(--text-body-sm)' }}>
              {(profile?.display_name || '?').charAt(0)}
            </div>
            <button
              onClick={async () => {
                await supabase.auth.signOut()
                document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT'
                router.push('/login')
              }}
              className="btn btn-ghost btn-sm"
            >
              退出
            </button>
          </div>
        </div>

        <div className="content-area">
          <div className="breadcrumb">
            <span className="breadcrumb-current">首页</span>
          </div>
          <h1>销售作战首页</h1>
          <p className="subtitle">
            {profile
              ? `${profile.display_name}，${activeSpace?.name || '请选择一个销售空间'}。今天要推的项目、要补的缺口、要切换的工作台都在这里。`
              : '加载中...'}
          </p>

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
                    <Link key={o.id} href={`/opportunities/${o.id}`} className="queue-card">
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

          {/* 硬节点时间线 */}
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
      </div>
    </div>
  )
}
