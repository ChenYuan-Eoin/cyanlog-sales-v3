// F016 技术文档列表页
// 路径：/knowledge/documents

import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import {
  DOC_TYPE_LABEL,
  DOC_TYPE_COLOR,
  type TechDocument,
} from '@/lib/tech-documents/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function TechDocumentsPage() {
  const { data: records } = await supabaseAdmin
    .from('tech_documents')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(50)

  const docs = (records as TechDocument[] | null) || []

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-1">技术文档</h1>
          <p className="text-sm text-slate-500">
            产品说明书、技术白皮书、API 文档、部署手册统一管理
          </p>
        </div>
        <Link href="/knowledge/documents/new">
          <Button>+ 新建文档</Button>
        </Link>
      </div>

      {docs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="text-4xl mb-4">📖</div>
            <p className="text-slate-700 font-medium mb-2">还没有文档</p>
            <p className="text-sm text-slate-500 mb-4">添加技术文档供团队查阅</p>
            <Link href="/knowledge/documents/new">
              <Button>+ 新建第一份文档</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-white divide-y">
          {docs.map((d) => (
            <Link
              key={d.id}
              href={`/knowledge/documents/${d.id}`}
              className="block px-4 py-4 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="font-medium text-slate-900">{d.title}</h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                    DOC_TYPE_COLOR[d.doc_type as keyof typeof DOC_TYPE_COLOR]
                  }`}
                >
                  {DOC_TYPE_LABEL[d.doc_type as keyof typeof DOC_TYPE_LABEL]}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="font-mono">{d.version}</span>
                <span>·</span>
                <span>查看 {d.view_count} 次</span>
                <span>·</span>
                <span>{d.updated_at ? new Date(d.updated_at).toLocaleDateString('zh-CN') : '—'}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
