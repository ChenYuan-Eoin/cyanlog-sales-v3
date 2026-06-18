'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  PenToolIcon,
  EyeIcon,
  GitCompareIcon,
  FileTextIcon,
  AlertTriangleIcon,
  ClockIcon,
  ZapIcon,
  UploadIcon,
  ArrowRightIcon,
  SearchIcon,
} from 'lucide-react'
import type { Contract } from '@/types'

type TaskFilter = 'all' | 'draft' | 'pending' | 'review' | 'approved'

// 金刚区卡片
const heroCards = [
  {
    id: 'draft',
    title: 'AI 智能起草',
    description: '内置 500+ 专业模板，通过对话式问卷分钟级生成合规合同',
    icon: PenToolIcon,
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    hoverBg: 'group-hover:bg-indigo-600',
    hoverText: 'group-hover:text-white',
    href: '/contracts/draft',
  },
  {
    id: 'review',
    title: '极速风险审核',
    description: '深度识别 80+ 类法律风险，自动提取摘要，秒级输出专业审查意见',
    icon: EyeIcon,
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    hoverBg: 'group-hover:bg-rose-600',
    hoverText: 'group-hover:text-white',
    href: '/contracts/new',
  },
  {
    id: 'compare',
    title: '文档精准比对',
    description: '多版本语义级差异识别，跨段落移动也能精准对齐，防范"暗箱修改"',
    icon: GitCompareIcon,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    hoverBg: 'group-hover:bg-emerald-600',
    hoverText: 'group-hover:text-white',
    href: '/contracts/new',
  },
]

export default function ContractCenterPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [drafts, setDrafts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')

  const fetchData = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}

      // 并行获取合同和草稿
      const [contractsRes, draftsRes] = await Promise.all([
        fetch('/api/contracts?pageSize=20', { headers }),
        fetch('/api/contracts/drafts', { headers }),
      ])

      if (contractsRes.ok) {
        const contractsData = await contractsRes.json()
        setContracts(contractsData.data || [])
      }

      if (draftsRes.ok) {
        const draftsData = await draftsRes.json()
        setDrafts(draftsData.data || [])
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // 资产看板统计
  const stats = useMemo(() => {
    const total = contracts.length + drafts.length
    const pending = contracts.filter((c) => c.status === 'PENDING' || c.status === 'PARSING' || c.status === 'ANALYZING').length
    const failed = contracts.filter((c) => c.status === 'FAILED').length
    const highRisk = contracts.reduce((acc, c) => {
      const job = c.latest_analysis_job
      if (job?.degraded) acc++
      return acc
    }, 0)
    return { total, pending, failed, highRisk }
  }, [contracts, drafts])

  // 任务流列表（合同 + 草稿合并）
  const tasks = useMemo(() => {
    const draftTasks = drafts.map((d) => ({
      id: d.id,
      name: d.title || '未命名草稿',
      type: 'draft' as const,
      aiSummary: { red: 0, yellow: 0, green: 0 },
      status: '起草中' as const,
      updatedAt: d.updated_at,
      href: `/contracts/draft?id=${d.id}`,
    }))

    const contractTasks = contracts.map((c) => ({
      id: c.id,
      name: c.filename,
      type: 'contract' as const,
      aiSummary: { red: 0, yellow: 0, green: 0 },
      status: (c.status === 'COMPLETED' ? '审核完成' : c.status === 'PENDING' ? '待审核' : c.status === 'PARSING' ? '解析中' : c.status === 'ANALYZING' ? '审核中' : '审核失败') as string,
      updatedAt: c.updated_at,
      href: `/contracts/${c.id}`,
    }))

    const all = [...draftTasks, ...contractTasks].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    if (taskFilter === 'all') return all
    if (taskFilter === 'draft') return all.filter((t) => t.type === 'draft')
    if (taskFilter === 'pending') return all.filter((t) => t.status === '待审核' || t.status === '解析中' || t.status === '审核中')
    if (taskFilter === 'review') return all.filter((t) => t.status === '审核完成')
    return all.filter((t) => t.status === '审核失败')
  }, [contracts, drafts, taskFilter])

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-[1480px] px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">合同中心</h1>
            <p className="text-sm text-slate-500 mt-1">合同全生命周期管理 — 起草、审核、比对、归档</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative hidden sm:block">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索合同..."
                className="pl-9 pr-4 py-2 bg-white border rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <Link href="/contracts/new">
              <Button>
                <UploadIcon className="h-4 w-4 mr-1.5" />
                上传合同
              </Button>
            </Link>
          </div>
        </div>

        {/* 金刚区 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {heroCards.map((card) => {
            const Icon = card.icon
            return (
              <Link key={card.id} href={card.href} className="group">
                <Card className="h-full cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-slate-200">
                  <CardContent className="p-6">
                    <div className={`w-12 h-12 ${card.bg} rounded-xl flex items-center justify-center mb-4 ${card.hoverBg} transition-colors duration-200`}>
                      <Icon className={`h-6 w-6 ${card.color} ${card.hoverText} transition-colors duration-200`} />
                    </div>
                    <h3 className="font-bold text-slate-900 text-lg mb-2">{card.title}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed mb-4">{card.description}</p>
                    <div className={`flex items-center text-sm font-medium ${card.color}`}>
                      立即开始
                      <ArrowRightIcon className="ml-1 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>

        {/* 资产看板 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          <StatCard
            icon={<FileTextIcon className="h-5 w-5 text-slate-500" />}
            label="合同总数"
            value={stats.total}
            trend={{ label: '本周', value: `+${Math.min(contracts.length, 5)}` }}
            trendColor="text-emerald-500"
          />
          <StatCard
            icon={<ClockIcon className="h-5 w-5 text-slate-500" />}
            label="正在处理"
            value={stats.pending}
            trend={{ label: '平均', value: '2h' }}
            trendColor="text-indigo-500"
          />
          <StatCard
            icon={<AlertTriangleIcon className="h-5 w-5 text-rose-500" />}
            label="高风险预警"
            value={stats.failed + stats.highRisk}
            trend={{ label: '需立即', value: '干预' }}
            trendColor="text-rose-500"
            accent
          />
          <StatCard
            icon={<ZapIcon className="h-5 w-5 text-slate-500" />}
            label="AI 提效时长"
            value={`${(contracts.length * 0.3).toFixed(0)}h`}
            trend={{ label: '本月', value: '节省' }}
            trendColor="text-emerald-500"
          />
        </div>

        {/* 任务流列表 */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">最近任务记录</CardTitle>
              <div className="flex gap-1">
                {(['all', 'draft', 'pending', 'review'] as TaskFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setTaskFilter(f)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                      taskFilter === f
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {f === 'all' ? '全部' : f === 'draft' ? '起草中' : f === 'pending' ? '待审核' : '已完成'}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="py-12 text-center text-slate-500">加载中...</div>
            ) : tasks.length === 0 ? (
              <div className="py-12 text-center text-slate-500">
                <FileTextIcon className="mx-auto h-12 w-12 text-slate-300 mb-4" />
                <p>暂无任务记录</p>
                <Link href="/contracts/draft">
                  <Button variant="outline" size="sm" className="mt-4">
                    创建新合同
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {tasks.map((task) => (
                  <Link key={task.id} href={task.href}>
                    <div className="flex items-center px-6 py-4 hover:bg-slate-50 transition cursor-pointer">
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center mr-4">
                        <FileTextIcon className="h-4 w-4 text-slate-400" />
                      </div>
                      <div className="flex-1 min-w-0 mr-4">
                        <div className="text-sm font-medium text-slate-900 truncate">{task.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {task.type === 'draft' ? '草稿' : '合同'} · {new Date(task.updatedAt).toLocaleDateString('zh-CN')}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={task.status} />
                        <ArrowRightIcon className="h-4 w-4 text-slate-300" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// 统计卡片
function StatCard({
  icon,
  label,
  value,
  trend,
  trendColor,
  accent = false,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  trend: { label: string; value: string }
  trendColor: string
  accent?: boolean
}) {
  return (
    <Card className={accent ? 'border-l-4 border-l-rose-500' : ''}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-2">
          {icon}
          <span className="text-xs text-slate-400 font-medium">{trend.label}</span>
        </div>
        <div className="flex items-end gap-2">
          <span className="text-2xl font-bold text-slate-900">{value}</span>
          <span className={`text-xs font-medium mb-1 ${trendColor}`}>{trend.value}</span>
        </div>
        <div className="text-xs text-slate-500 mt-1">{label}</div>
      </CardContent>
    </Card>
  )
}

// 状态标签
function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { variant: 'default' | 'secondary' | 'outline' | 'destructive'; label: string }> = {
    '起草中': { variant: 'secondary', label: '起草中' },
    '待审核': { variant: 'secondary', label: '待审核' },
    '解析中': { variant: 'default', label: '解析中' },
    '审核中': { variant: 'default', label: '审核中' },
    '审核完成': { variant: 'outline', label: '已完成' },
    '审核失败': { variant: 'destructive', label: '失败' },
  }
  const config = configs[status] || { variant: 'outline', label: status }
  return <Badge variant={config.variant}>{config.label}</Badge>
}
