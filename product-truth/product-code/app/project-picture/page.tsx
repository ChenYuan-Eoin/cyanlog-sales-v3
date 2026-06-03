// 项目拼图（SpaceX 风格系统总览）
// 路径：/project-picture
//
// 哲学：每个模块是系统的一个拼图。
// 创造力的体现：3 级 AI 降级链、Pre-commit 10 项硬约束
// 稳定性的体现：测试覆盖、health check、error_logs、rate limit

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'

export default function ProjectPicturePage() {
  const modules = [
    {
      name: '认证与权限',
      req: 'F003',
      icon: '🔐',
      pieces: [
        { name: 'JWT Cookie 认证', status: 'done' },
        { name: '三级角色（super/admin/sales/legal/finance/...）', status: 'done' },
        { name: '登录防爆破（5 次/15 分钟）', status: 'done' },
      ],
    },
    {
      name: '报价中心',
      req: 'F001-F004',
      icon: '💰',
      pieces: [
        { name: '报价单 CRUD + 列表/详情/编辑', status: 'done' },
        { name: '递增式单号生成（解决并发）', status: 'done' },
        { name: '三级审批工作流', status: 'done' },
      ],
    },
    {
      name: '合同审核',
      req: 'F005-F008',
      icon: '📄',
      pieces: [
        { name: 'OCR 解析（结构化 5 段）', status: 'done' },
        { name: '红绿灯规则引擎（8+ 测试）', status: 'done' },
        { name: 'Word 导出', status: 'done' },
      ],
    },
    {
      name: '标书中心',
      req: 'F014',
      icon: '📋',
      pieces: [
        { name: '招标文件 OCR 结构化提取', status: 'done' },
        { name: '5 段输出：基本/评分/技术/商务/时间', status: 'done' },
        { name: '信心度算法', status: 'done' },
      ],
    },
    {
      name: '配置中心',
      req: 'F009-F010',
      icon: '⚙',
      pieces: [
        { name: '合同规则可视化（DataTable + RuleBuilder）', status: 'in-progress' },
        { name: '税率 5 类预定义', status: 'done' },
        { name: '审批 3 级阈值表', status: 'done' },
        { name: 'AI 3 级降级链配置', status: 'done' },
      ],
    },
    {
      name: '知识库',
      req: 'F015-F017',
      icon: '📚',
      pieces: [
        { name: '案例库（成功/失败分类）', status: 'done' },
        { name: '技术文档（4 类 + 版本）', status: 'done' },
        { name: '商务资质（到期预警）', status: 'done' },
      ],
    },
    {
      name: '日程管理',
      req: 'F018-F019',
      icon: '📅',
      pieces: [
        { name: '任务/会议/跟进/提醒 4 类', status: 'done' },
        { name: '自动应用提醒规则', status: 'done' },
      ],
    },
    {
      name: '治理视图',
      req: 'F020-F022',
      icon: '🚀',
      pieces: [
        { name: '业务地图（6 模块可视化）', status: 'done' },
        { name: '技术架构（9 章节）', status: 'done' },
        { name: 'AI 降级监控（3 级链）', status: 'done' },
        { name: '本项目拼图（你正在看）', status: 'done' },
      ],
    },
  ]

  const stabilityMetrics = [
    { label: '单元测试', value: '160+', sub: 'lib + app/api', icon: '🧪' },
    { label: 'E2E 测试', value: '5+', sub: '登录/配置/报价/health', icon: '🎭' },
    { label: 'Pre-commit', value: '10/10', sub: '5 checklist + 5 循环', icon: '🪝' },
    { label: 'REQ 完成', value: '18/28', sub: 'P0 全部 + P1/P2 关键', icon: '✅' },
    { label: '硬约束', value: '已启用', sub: 'pre-commit + 密钥轮换', icon: '🔒' },
    { label: '可观测性', value: '已就位', sub: 'health + error_logs + rate-limit', icon: '👁' },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* 页头 */}
      <header className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-2">项目拼图</h1>
        <p className="text-slate-600 max-w-2xl">
          以 SpaceX 哲学构建：每个模块是系统的一个拼图，<strong>创造力</strong>（3 级 AI 降级）+
          <strong>稳定性</strong>（10 项硬约束 + 错误捕获 + 速率限制）共同保证系统可发布。
        </p>
      </header>

      {/* 稳定性指标 */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">稳定性指标</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {stabilityMetrics.map((m) => (
            <Card key={m.label}>
              <CardContent className="py-4 text-center">
                <div className="text-2xl mb-1">{m.icon}</div>
                <div className="text-lg font-bold text-slate-900">{m.value}</div>
                <div className="text-xs font-medium text-slate-700 mt-0.5">{m.label}</div>
                <div className="text-xs text-slate-500 mt-1">{m.sub}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* 8 个核心模块拼图 */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">8 个核心模块</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {modules.map((m) => {
            const doneCount = m.pieces.filter((p) => p.status === 'done').length
            const total = m.pieces.length
            return (
              <Card key={m.name} className="hover:border-slate-400 transition-colors">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="text-2xl">{m.icon}</div>
                    <span className="text-xs font-mono text-slate-400">{m.req}</span>
                  </div>
                  <h3 className="font-semibold text-slate-900 mb-1">{m.name}</h3>
                  <div className="text-xs text-slate-500 mb-3">
                    {doneCount}/{total} 子功能
                  </div>
                  <ul className="space-y-1">
                    {m.pieces.map((p, idx) => (
                      <li key={idx} className="flex items-start gap-1.5 text-xs">
                        <span
                          className={
                            p.status === 'done'
                              ? 'text-emerald-600 mt-0.5'
                              : 'text-amber-600 mt-0.5'
                          }
                        >
                          {p.status === 'done' ? '●' : '○'}
                        </span>
                        <span className="text-slate-600">{p.name}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      {/* 关键能力速览 */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">关键能力</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardContent className="py-5">
              <h3 className="font-semibold text-slate-900 mb-2">🛟 3 级 AI 降级</h3>
              <p className="text-sm text-slate-600 mb-3">
                本地 LM Studio → 云端 AI → 规则引擎
                任何一级失败自动降级，业务不中断
              </p>
              <Link href="/ai-fallback" className="text-sm text-blue-600 hover:underline">
                查看监控 →
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-5">
              <h3 className="font-semibold text-slate-900 mb-2">🔒 10 项硬约束</h3>
              <p className="text-sm text-slate-600 mb-3">
                typecheck + lint + test + 5 类循环（反馈/健康/错误/业务/CI）每次提交自动检查
              </p>
              <Link href="/tech-architecture" className="text-sm text-blue-600 hover:underline">
                查看架构 →
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-5">
              <h3 className="font-semibold text-slate-900 mb-2">👁 可观测性</h3>
              <p className="text-sm text-slate-600 mb-3">
                /api/health 健康检查 + error_logs 自托管 + 登录速率限制
                不依赖第三方 SaaS
              </p>
              <Link href="/api/health" className="text-sm text-blue-600 hover:underline">
                打开 /api/health →
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 整体导航 */}
      <section>
        <h2 className="text-xl font-semibold text-slate-900 mb-4">页面导航</h2>
        <div className="rounded-lg border bg-white p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <Link href="/business-map" className="text-blue-600 hover:underline">→ 业务地图</Link>
            <Link href="/tech-architecture" className="text-blue-600 hover:underline">→ 技术架构</Link>
            <Link href="/ai-fallback" className="text-blue-600 hover:underline">→ AI 降级监控</Link>
            <Link href="/knowledge" className="text-blue-600 hover:underline">→ 知识库</Link>
            <Link href="/schedule" className="text-blue-600 hover:underline">→ 日程管理</Link>
            <Link href="/configs" className="text-blue-600 hover:underline">→ 配置中心</Link>
            <Link href="/quotes" className="text-blue-600 hover:underline">→ 报价中心</Link>
            <Link href="/contracts" className="text-blue-600 hover:underline">→ 合同审核</Link>
          </div>
        </div>
      </section>

      <footer className="mt-10 pt-6 border-t text-xs text-slate-500">
        真相来源：<code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded mx-1">product-truth/REQ_REGISTRY.yml</code>
        · 详情见 REQ_REGISTRY 与各模块实施证据
      </footer>
    </div>
  )
}
