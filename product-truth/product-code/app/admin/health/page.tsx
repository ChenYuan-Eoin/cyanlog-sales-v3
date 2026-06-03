// 数据库 Schema 健康检查页
// 路径：/admin/health
// 显示哪些表已存在/缺失（供运维快速判断）

import { checkSchemaStatus } from '@/lib/schema-check'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function SchemaHealthPage() {
  const status = await checkSchemaStatus()
  const missing = status.filter((s) => !s.exists)
  const existing = status.filter((s) => s.exists)

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-1">数据库 Schema 状态</h1>
        <p className="text-sm text-slate-500">
          检查生产数据库的必需表是否存在。缺失的表会导致对应模块不可用。
        </p>
      </header>

      {/* 摘要 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{status.length}</div>
            <div className="text-xs text-slate-500 uppercase tracking-wide mt-1">总表数</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-emerald-700">{existing.length}</div>
            <div className="text-xs text-slate-500 uppercase tracking-wide mt-1">已存在</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div
              className={`text-2xl font-bold ${missing.length > 0 ? 'text-rose-700' : 'text-emerald-700'}`}
            >
              {missing.length}
            </div>
            <div className="text-xs text-slate-500 uppercase tracking-wide mt-1">缺失</div>
          </CardContent>
        </Card>
      </div>

      {/* 缺失警告 */}
      {missing.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 mb-6">
          <h2 className="font-semibold text-rose-900 mb-2">⚠️ {missing.length} 个表缺失</h2>
          <p className="text-sm text-rose-800 mb-3">
            请按顺序运行{' '}
            <a
              href="https://supabase.com/dashboard/project/wfawwhphfqqwfwrrkogy/sql/new"
              target="_blank"
              rel="noopener"
              className="underline"
            >
              Supabase SQL Editor
            </a>{' '}
            中的迁移文件，详见{' '}
            <code className="font-mono bg-rose-100 px-1 rounded">SUPABASE_SETUP.md</code>
          </p>
          <ul className="text-sm space-y-1">
            {missing.map((m) => (
              <li key={m.table} className="text-rose-700 font-mono">
                ❌ {m.table}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 完整列表 */}
      <Card>
        <CardContent className="py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 font-medium text-slate-700">表名</th>
                <th className="text-left py-3 font-medium text-slate-700">状态</th>
                <th className="text-left py-3 font-medium text-slate-700">行数</th>
              </tr>
            </thead>
            <tbody>
              {status.map((s) => (
                <tr key={s.table} className="border-b last:border-0">
                  <td className="py-2 font-mono text-slate-700">{s.table}</td>
                  <td className="py-2">
                    {s.exists ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        ✓ 存在
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                        ✗ 缺失
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-slate-600">{s.rowCount ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-slate-500">
        💡 跑迁移后刷新页面，状态会自动更新。
      </p>
    </div>
  )
}
