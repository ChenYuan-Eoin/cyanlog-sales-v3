'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface DashboardStats {
  activeOpportunities: number
  todayNodes: number
  pendingApproval: number
  weeklyTarget: number
}

interface AgendaItem {
  time: string
  title: string
  description: string
}

export default function HomePage() {
  const router = useRouter()
  const [stats] = useState<DashboardStats>({
    activeOpportunities: 27,
    todayNodes: 4,
    pendingApproval: 11,
    weeklyTarget: 3210,
  })
  const [userInfo] = useState({ name: '张一鸣', department: '华东销售' })

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      router.push('/login')
      return
    }
    // Fetch user info and stats here
  }, [router])

  const agenda: AgendaItem[] = [
    { time: '09:30', title: '确认报价交付日', description: '3 个项目待补。' },
    { time: '11:00', title: '标书材料校核', description: '补齐案例与附件。' },
    { time: '15:30', title: '合同审核反馈', description: '确认是否进入审。' },
  ]

  const reminders = [
    { label: '待补客户信息', count: '3 条' },
    { label: '待锁定节点', count: '4 个项目' },
    { label: '品牌与模板更新', count: '1 项待确认' },
  ]

  return (
    <div className="dashboard-shell">
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
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </Link>
          <Link href="/configs" title="配置">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v6m0 6v6m4.22-10.22l4.24-4.24M6.34 6.34L2.1 2.1m17.9 9.9h-6m-6 0H1.9" />
            </svg>
          </Link>
        </nav>
      </div>

      {/* Sidebar Navigation */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Cyanlog</h2>
          <p>销售支撑平台</p>
        </div>

        <div style={{ padding: '12px', marginBottom: '16px', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ fontSize: 'var(--text-body-sm)', fontWeight: 600, color: 'white', marginBottom: 4 }}>
            华东销售作战空间
          </div>
          <div style={{ fontSize: 'var(--text-caption)', color: 'var(--ink-400)' }}>
            12 个活跃机会 · 6 个关键节点
          </div>
          <div style={{ marginTop: 8, textAlign: 'right' }}>
            <span style={{ fontSize: 'var(--text-overline)', color: 'var(--accent-400)', background: 'rgba(37,99,235,0.15)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>
              ONES
            </span>
          </div>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">用户旅程</div>
          <Link href="/" className="nav-link active">
            <span>首页</span>
          </Link>
          <Link href="/customers" className="nav-link">
            <span>客户接触</span>
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--ink-500)', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>3</span>
          </Link>
          <Link href="/opportunities" className="nav-link">
            <span>机会分流</span>
          </Link>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">报价中心</div>
          <Link href="/quotes" className="nav-link">
            <span>报价中心</span>
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--ink-500)', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>14</span>
          </Link>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">标书解析</div>
          <Link href="/tenders" className="nav-link">
            <span>标书解析</span>
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--ink-500)', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>9</span>
          </Link>
        </div>

        <div className="nav-section" style={{ marginTop: 'auto' }}>
          <div className="nav-section-title">系统支撑</div>
          <Link href="/configs" className="nav-link">
            <span>配置中心</span>
          </Link>
          <Link href="/brand" className="nav-link">
            <span>品牌中心</span>
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="main">
        {/* Topbar */}
        <div className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-1)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--fg-3)',
              fontSize: 'var(--text-body-sm)',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <span>搜索机会、客户、单据、模板</span>
              <span style={{ marginLeft: 'auto', color: 'var(--fg-4)' }}>⌘K</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 'var(--text-body-sm)', fontWeight: 500, color: 'var(--fg-1)' }}>{userInfo.name}</div>
              <div style={{ fontSize: 'var(--text-caption)', color: 'var(--fg-3)' }}>{userInfo.department}</div>
            </div>
            <div style={{
              width: 36,
              height: 36,
              background: 'linear-gradient(135deg, var(--cyan-500), var(--cyan-700))',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 600,
              fontSize: 'var(--text-body-sm)',
            }}>
              张
            </div>
          </div>
        </div>

        {/* Page Content */}
        <div style={{ padding: '24px 28px' }}>
          {/* Breadcrumb */}
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--accent)', fontWeight: 500 }}>首页</span>
            <h1 style={{ fontSize: 'var(--text-h1)', fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>销售作战首页</h1>
            <p style={{ fontSize: 'var(--text-body)', color: 'var(--fg-2)', marginTop: 4 }}>今天要推的项目、要补的缺口、要切换的工作台都在这里。</p>
          </div>

          {/* Stats Grid */}
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">活跃机会</span>
                <span style={{ fontSize: 'var(--text-caption)', color: 'var(--accent)', background: 'var(--accent-50)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>总览</span>
              </div>
              <div className="stat-card-value">{stats.activeOpportunities}</div>
              <div className="stat-card-change up">+6 较上周</div>
            </div>

            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">今日硬节点</span>
                <span style={{ fontSize: 'var(--text-caption)', color: 'var(--warning-700)', background: 'var(--warning-100)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>{stats.todayNodes}</span>
              </div>
              <div className="stat-card-value" style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                {stats.todayNodes} <span style={{ fontSize: 'var(--text-h3)' }}>个</span>
              </div>
              <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>需跨角色协同</div>
            </div>

            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">待审批</span>
                <span style={{ fontSize: 'var(--text-caption)', color: 'var(--accent-700)', background: 'var(--accent-100)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>{stats.pendingApproval}</span>
              </div>
              <div className="stat-card-value" style={{ fontSize: '28px' }}>5h 28m</div>
              <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>平均停留</div>
            </div>

            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">本周签约目标</span>
                <span style={{ fontSize: 'var(--text-caption)', color: 'var(--success-700)', background: 'var(--success-100)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>6 单</span>
              </div>
              <div className="stat-card-value">{stats.weeklyTarget.toLocaleString()}万</div>
              <div className="stat-card-change" style={{ color: 'var(--fg-3)' }}>完成率 62%</div>
            </div>
          </div>

          {/* Content Grid */}
          <div className="content-grid">
            {/* Hero Card */}
            <div className="hero-card">
              <div className="eyebrow">华东销售作战空间</div>
              <h2 style={{ fontSize: '36px', fontWeight: 600, marginBottom: 8 }}>今日优先队列</h2>
              <p style={{ color: 'var(--fg-on-dark-2)', marginBottom: 24 }}>优先处理下列项目与动作。每一项都还差一个明确节点。</p>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{
                  padding: '16px 20px',
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  minWidth: 200,
                }}>
                  <div style={{ fontSize: 'var(--text-body-sm)', color: 'white', marginBottom: 4 }}>华润万家云平台二期</div>
                  <div style={{ fontSize: 'var(--text-caption)', color: 'var(--ink-400)' }}>报价确认中 · 待补交付日</div>
                </div>
                <div style={{
                  padding: '16px 20px',
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  minWidth: 200,
                }}>
                  <div style={{ fontSize: 'var(--text-body-sm)', color: 'white', marginBottom: 4 }}>省医疗云平台招标</div>
                  <div style={{ fontSize: 'var(--text-caption)', color: 'var(--ink-400)' }}>标书准备中 · 待校案例</div>
                </div>
                <div style={{
                  padding: '16px 20px',
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  minWidth: 200,
                }}>
                  <div style={{ fontSize: 'var(--text-body-sm)', color: 'white', marginBottom: 4 }}>连锁零售续约协议</div>
                  <div style={{ fontSize: 'var(--text-caption)', color: 'var(--ink-400)' }}>合同审核中 · 待确认账期</div>
                </div>
              </div>
            </div>

            {/* Side Panel */}
            <div className="side-panel">
              {/* Today's Agenda */}
              <div className="side-card">
                <div className="side-card-header">今日安排</div>
                {agenda.map((item, index) => (
                  <div key={index} className="agenda-item">
                    <div className="agenda-time">{item.time}</div>
                    <div className="agenda-content">
                      <p>{item.title}</p>
                      <span>{item.description}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Reminders */}
              <div className="side-card">
                <div className="side-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>今日提醒</span>
                  <span style={{
                    fontSize: 'var(--text-overline)',
                    color: 'var(--warning-700)',
                    background: 'var(--warning-100)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-sm)',
                  }}>3</span>
                </div>
                {reminders.map((item, index) => (
                  <div key={index} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: index < reminders.length - 1 ? '1px solid var(--border-2)' : 'none',
                  }}>
                    <span style={{ fontSize: 'var(--text-body-sm)', color: 'var(--fg-2)' }}>{item.label}</span>
                    <span style={{ fontSize: 'var(--text-body-sm)', fontWeight: 500 }}>{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
            <Link href="/customers/new" style={{
              padding: '12px 24px',
              background: 'white',
              border: '1px solid var(--border-1)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-sm)',
              fontWeight: 500,
              color: 'var(--fg-1)',
            }}>
              录入客户接触
            </Link>
            <Link href="/opportunities/new" style={{
              padding: '12px 24px',
              background: 'var(--accent)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-sm)',
              fontWeight: 500,
              color: 'white',
            }}>
              新建机会分流
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
