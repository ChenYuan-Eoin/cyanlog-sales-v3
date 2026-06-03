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
      rea: 'F015',
    },
    {
      name: '技术文档',
      href: '/knowledge/documents',
      icon: '📖',
      desc: '产品说明书/技术白皮书/API/部署手册',
      rea: 'F016',
    },
    {
      name: '商务资质',
      href: '/knowledge/qualifications',
      icon: '🏛',
      desc: '企业资质/人员资质/业绩/合作伙伴',
      rea: 'F017',
    },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-1">知识库</h1>
      <p className="text-sm text-slate-500 mb-6">3 个子模块共同构成团队知识资产</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {subPages.map((p) => (
          <Link key={p.href} href={p.href} className="block">
            <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all h-full">
              <CardContent className="py-6">
                <div className="text-3xl mb-3">{p.icon}</div>
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="font-semibold text-slate-900">{p.name}</h3>
                  <span className="text-xs font-mono text-slate-400">{p.rea}</span>
                </div>
                <p className="text-sm text-slate-600">{p.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
