// F016 技术文档详情页

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import {
  DOC_TYPE_LABEL,
  DOC_TYPE_COLOR,
  type TechDocument,
} from '@/lib/tech-documents/types'

interface PageProps {
  params: { id: string }
}

export default async function TechDocumentDetailPage({ params }: PageProps) {
  const { data, error } = await supabaseAdmin
    .from('tech_documents')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !data) notFound()

  const d = data as TechDocument

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <Link href="/knowledge/documents" className="text-sm text-slate-500 hover:text-slate-700 mb-4 inline-block">
        ← 返回文档库
      </Link>

      <header className="mb-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">{d.title}</h1>
          <span
            className={`text-xs px-2.5 py-1 rounded-full flex-shrink-0 ${
              DOC_TYPE_COLOR[d.doc_type as keyof typeof DOC_TYPE_COLOR]
            }`}
          >
            {DOC_TYPE_LABEL[d.doc_type as keyof typeof DOC_TYPE_LABEL]}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span className="font-mono">{d.version}</span>
          <span>·</span>
          <span>查看 {d.view_count} 次</span>
          {d.file_url && (
            <>
              <span>·</span>
              <a href={d.file_url} target="_blank" rel="noopener" className="text-blue-600 hover:underline">
                下载附件
              </a>
            </>
          )}
        </div>
      </header>

      <article className="rounded-lg border bg-white p-6">
        {d.content ? (
          <pre className="whitespace-pre-wrap text-sm text-slate-800 leading-relaxed font-sans">
            {d.content}
          </pre>
        ) : (
          <p className="text-sm text-slate-400 italic">（文档内容为空）</p>
        )}
      </article>

      {d.tags && d.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {d.tags.map((t) => (
            <span key={t} className="text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-700">
              #{t}
            </span>
          ))}
        </div>
      )}

      <footer className="mt-8 pt-4 border-t text-xs text-slate-500">
        更新于 {d.updated_at ? new Date(d.updated_at).toLocaleString('zh-CN') : '—'}
      </footer>
    </div>
  )
}
