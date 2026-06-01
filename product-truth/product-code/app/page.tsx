'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface DashboardStats {
  activeOpportunities: number
  todayNodes: number
  pendingApproval: number
  monthlyContracts: number
}

interface ContractRow {
  id: string
  filename: string
  status: string
  created_at: string
  parsed_text: string | null
}

interface RecentItem {
  id: string
  title: string
  subtitle: string
  status: string
  href: string
}

const statusMap: Record<string, { label: string; pillClass: string }> = {
  PENDING: { label: '待审核', pillClass: 'pill warning' },
  PARSING: { label: '解析中', pillClass: 'pill info' },
  ANALYZING: { label: '审核中', pillClass: 'pill info' },
  COMPLETED: { label: '已完成', pillClass: 'pill success' },
  FAILED: { label: '失败', pillClass: 'pill danger' },
  DRAFT: { label: '草稿', pillClass: 'pill outline' },
  PENDING_APPROVAL: { label: '审批中', pillClass: 'pill info' },
  APPROVED: { label: '已批准', pillClass: 'pill success' },
  REJECTED: { label: '已驳回', pillClass: 'pill danger' },
}

export default function HomePage() {
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recent, setRecent] = useState<RecentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState('我')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    try {
      // 直接从 Supabase 拉（客户端 RLS 会自动过滤）
      const [contractsRes, quotesRes] = await Promise.all([
        supabase.from('contracts').select('id, filename, status, created_at, parsed_text').order('created_at', { ascending: false }).limit(50),
        supabase.from('quotes').select('id, quote_no, customer_name, status, created_at').order('created_at', { ascending: false }).limit(20),
      ])

      const contracts: ContractRow[] = contractsRes.data || []
      const quotes = quotesRes.data || []

      // 统计
      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

      const activeOpportunities = contracts.filter(c =>
        ['PENDING', 'PARSING', 'ANALYZING'].includes(c.status)
      ).length

      const todayNodes = contracts.filter(c => {
        const d = new Date(c.created_at)
        return d.toDateString() === now.toDateString()
      }).length

      const pendingApproval = contracts.filter(c => c.status === 'PENDING').length
      const monthlyContracts = contracts.filter(c => new Date(c.created_at) >= startOfMonth).length

      setStats({ activeOpportunities, todayNodes, pendingApproval, monthlyContracts })

      // 最近访问
      const recentItems: RecentItem[] = [
        ...contracts.slice(0, 4).map(c => ({
          id: c.id,
          title: c.filename,
          subtitle: new Date(c.created_at).toLocaleString('zh-CN'),
          status: c.status,
          href: `/contracts/${c.id}`,
        })),
        ...quotes.slice(0, 3).map(q => ({
          id: q.id,
          title: q.quote_no,
          subtitle: q.customer_name || '',
          status: q.status,
          href: `/quotes/${q.id}`,
        })),
      ].slice(0, 6)

      setRecent(recentItems)
    } catch (e) {
      console.error('[Dashboard] load error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 拿用户信息
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        const meta = data.user.user_metadata || {}
        setUserName(meta.display_name || meta.full_name || data.user.email?.split('@')[0] || '我')
      }
    })

    loadDashboard()
  }, [loadDashboard])

  return (
    <div className="dashboard-shell">
      {/* Mobile Overlay */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* Left Rail */}
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
        </nav>
      </div>

      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Cyanlog</h2>
          <p>销售支撑平台</p>
        </div>

        <div className="workspace-card">
          <div className="workspace-name">华东销售作战空间</div>
          <div className="workspace-meta">{stats?.activeOpportunities ?? 0} 个活跃机会 · {stats?.todayNodes ?? 0} 个今日节点</div>
          <div style={{ marginTop: 8, textAlign: 'right' }}>
            <span className="workspace-tag">ONES</span>
          </div>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">用户旅程</div>
          <Link href="/" className="nav-link active"><span>首页</span></Link>
          <Link href="/customers" className="nav-link">
            <span>客户接触</span>
            <span className="nav-count">3</span>
          </Link>
          <Link href="/opportunities" className="nav-link"><span>机会分流</span></Link>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">报价中心</div>
          <Link href="/quotes" className="nav-link">
            <span>报价中心</span>
            <span className="nav-count">14</span>
          </Link>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">标书解析</div>
          <Link href="/tenders" className="nav-link">
            <span>标书解析</span>
            <span className="nav-count">9</span>
          </Link>
        </div>

        <div className="nav-section" style={{ marginTop: 'auto' }}>
          <div className="nav-section-title">系统支撑</div>
          <Link href="/configs" className="nav-link"><span>配置中心</span></Link>
          <Link href="/brand" className="nav-link"><span>品牌中心</span></Link>
        </div>
      </div>

      {/* Main */}
      <div className="main">
        {/* Topbar */}
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
            <input placeholder="搜索机会、客户、单据、模板" />
            <span className="kbd">⌘K</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 'var(--text-body-sm)', fontWeight: 500 }}>{userName}</div>
              <div style={{ fontSize: 'var(--text-caption)', color: 'var(--fg-3)' }}>华东销售</div>
            </div>
            <div className="avatar brand" style={{ width: 36, height: 36, fontSize: 'var(--text-body-sm)' }}>
              {userName.charAt(0).toUpperCase()}
            </div>
            <button
              onClick={async () => {
                document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT'
                await supabase.auth.signOut()
                router.push('/login')
              }}
              className="btn btn-ghost btn-sm"
              title="退出登录"
            >
              退出
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="content-area">
          <div className="breadcrumb">
            <span className="breadcrumb-current">首页</span>
          </div>
          <h1>销售作战首页</h1>
          <p className="subtitle">今天要推的项目、要补的缺口、要切换的工作台都在这里。</p>

          {/* Stats Grid */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">活跃机会</span>
                <span className="stat-tag">总览</span>
              </div>
              {loading ? (
                <div className="skeleton" style={{ width: 60, height: 32 }} />
              ) : (
                <div className="stat-card-value">{stats?.activeOpportunities ?? 0}</div>
              )}
              <div className="stat-card-change">最近 7 天</div>
            </div>

            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">今日硬节点</span>
                <span className="stat-tag warning">{stats?.todayNodes ?? 0}</span>
              </div>
              {loading ? (
                <div className="skeleton" style={{ width: 60, height: 32 }} />
              ) : (
                <div className="stat-card-value">{stats?.todayNodes ?? 0} <span style={{ fontSize: 'var(--text-h3)' }}>个</span></div>
              )}
              <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>需跨角色协同</div>
            </div>

            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">待审批</span>
                <span className="stat-tag info">{stats?.pendingApproval ?? 0}</span>
              </div>
              {loading ? (
                <div className="skeleton" style={{ width: 80, height: 32 }} />
              ) : (
                <div className="stat-card-value" style={{ fontSize: '28px' }}>—</div>
              )}
              <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>无积压</div>
            </div>

            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">本月合同</span>
                <span className="stat-tag success">{stats?.monthlyContracts ?? 0}</span>
              </div>
              {loading ? (
                <div className="skeleton" style={{ width: 60, height: 32 }} />
              ) : (
                <div className="stat-card-value">{stats?.monthlyContracts ?? 0}</div>
              )}
              <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>单</div>
            </div>
          </div>

          {/* Content Grid */}
          <div className="content-grid">
            <div className="hero-card">
              <div className="eyebrow">华东销售作战空间</div>
              <h2>今日优先队列</h2>
              <p>优先处理下列项目与动作。每一项都还差一个明确节点。</p>

              <div className="queue-grid">
                {loading ? (
                  <>
                    <div className="skeleton queue-card" />
                    <div className="skeleton queue-card" />
                    <div className="skeleton queue-card" />
                  </>
                ) : recent.length === 0 ? (
                  <div className="empty-state">
                    <p>暂无活跃项目</p>
                    <Link href="/contracts/new" className="btn btn-primary">上传第一个合同</Link>
                  </div>
                ) : (
                  recent.slice(0, 3).map(item => (
                    <Link href={item.href} key={item.id} className="queue-card">
                      <div className="queue-card-title">{item.title}</div>
                      <div className="queue-card-meta">
                        {statusMap[item.status]?.label || item.status}
                        {' · '}
                        {item.subtitle}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div className="side-panel">
              <div className="side-card">
                <div className="side-card-header">今日安排</div>
                <div className="agenda-item">
                  <div className="agenda-time">09:30</div>
                  <div className="agenda-content">
                    <p>确认报价交付日</p>
                    <span>3 个项目待补</span>
                  </div>
                </div>
                <div className="agenda-item">
                  <div className="agenda-time">11:00</div>
                  <div className="agenda-content">
                    <p>标书材料校核</p>
                    <span>补齐案例与附件</span>
                  </div>
                </div>
                <div className="agenda-item">
                  <div className="agenda-time">15:30</div>
                  <div className="agenda-content">
                    <p>合同审核反馈</p>
                    <span>确认是否进入审批</span>
                  </div>
                </div>
              </div>

              <div className="side-card">
                <div className="side-card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>最近访问</span>
                  <button onClick={loadDashboard} className="btn btn-ghost btn-sm" title="刷新">↻</button>
                </div>
                {loading ? (
                  <div className="skeleton" style={{ height: 120 }} />
                ) : recent.length === 0 ? (
                  <div className="empty-mini">暂无数据</div>
                ) : (
                  recent.map(item => (
                    <Link href={item.href} key={item.id} className="recent-row">
                      <div>
                        <div className="recent-title">{item.title}</div>
                        <div className="recent-meta">{item.subtitle}</div>
                      </div>
                      <span className={statusMap[item.status]?.pillClass || 'pill'}>
                        {statusMap[item.status]?.label || item.status}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
