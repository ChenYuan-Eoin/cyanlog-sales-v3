// 知识库首页（导航到 3 个子模块）
// 路径：/knowledge

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'

export default function KnowledgeIndexPage() {
  const subPages = [
    {
      name: '案例库',
      href: '/knowledge/cases',
      icon: '📚',
      desc: '成功案例、失败案例管理',
      req: 'F015',
      status: '已实现',
      features: ['列表+筛选', '新建/编辑/查看', '成功/失败统计', '行业标签'],
    },
    {
      name: '技术文档',
      href: '/knowledge/documents',
      icon: '📖',
      desc: '产品说明书/技术白皮书/API/部署手册',
      req: 'F016',
      status: '已实现',
      features: ['文档分类', '版本管理', '权限控制'],
    },
    {
      name: '商务资质',
      href: '/knowledge/qualifications',
      icon: '🏛',
      desc: '企业资质/人员资质/业绩/合作伙伴',
      req: 'F017',
      status: '已实现',
      features: ['资质管理', '有效期提醒', '附件上传'],
    },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* 页头 */}
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-2">知识库</h1>
        <p className="text-slate-600 max-w-2xl">
          3 个子模块共同构成团队知识资产。所有模块支持 RBAC 权限控制（基于三级 Scope：组织/部门/销售空间）。
        </p>
      </div>

      {/* 子模块卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {subPages.map((p) => (
          <Link key={p.href} href={p.href} className="block">
            <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all h-full">
              <CardContent className="py-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="text-3xl">{p.icon}</div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                    {p.status}
                  </span>
                </div>
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="font-semibold text-slate-900">{p.name}</h3>
                  <span className="text-xs font-mono text-slate-400">{p.req}</span>
                </div>
                <p className="text-sm text-slate-600 mb-3">{p.desc}</p>
                <ul className="space-y-1">
                  {p.features.map((f) => (
                    <li key={f} className="text-xs text-slate-500 flex items-center gap-1.5">
                      <span className="text-green-500">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* 知识库 RAG 接入说明 */}
      <div className="mt-8 rounded-lg border bg-blue-50 border-blue-200 p-5">
        <h3 className="font-medium text-blue-900 mb-2">🧠 知识库 + RAG</h3>
        <p className="text-sm text-blue-800 mb-2">
          所有知识库内容已接入 RAG 检索增强生成系统：
        </p>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• 文档变更自动重新索引（<code className="text-xs">lib/rag/updater.ts</code>）</li>
          <li>• 增量索引 + 段落级向量检索（pgvector，1536 维）</li>
          <li>• 支持多模态理解（OCR + 视觉分析）</li>
          <li>• 检索评估：Recall@K / Precision@K / Faithfulness</li>
        </ul>
      </div>
    </div>
  )
}
